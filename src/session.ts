import type {
	AgentSettledEvent,
	AgentStartEvent,
	CustomEntry,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionEvent,
	InputEvent,
	InputEventResult,
	SessionShutdownEvent,
	SessionStartEvent,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { ActivityMeter, rateToLevel, TokRateTracker } from "./activity-meter.ts";
import { ROUTED_MODEL_CHANNEL, routedModelAnnouncement } from "./autorouter-feed.ts";
import {
	dimAttribute,
	getThinkingLevelColorizer,
	isThinkingLevel,
	ELAPSED_INTERVAL_MS,
	fadeThemeColorString,
	formatElapsed,
	formatTokenRate,
	formatTokens,
	isFullyDefaultAppearance,
	METER_INTERVAL_MS,
	RESPONSE_MODEL_FADE_MS,
	RESPONSE_MODEL_HOLD_MS,
	RESPONSE_MODEL_SLIDE_FRAME_MS,
	RESPONSE_MODEL_SLIDE_MS,
	SHIMMER_INTERVAL_MS,
	slideOutTail,
	SPINNER_FRAME_MS,
	SPINNER_FRAMES,
	TOKEN_RATE_FADE_SHADE_COUNT,
	StreamingWordCounter,
	type ThinkingLevel,
} from "./format.ts";
import { buildLoaderMessage } from "./loader-message.ts";
import { showMenu } from "./menu.ts";
import { getResponseModelColorizer } from "./nvidia-green.ts";
import { registerSetupCommand } from "./setup-command.ts";
import { applyMenuResult, buildMenuSections, loadSettings, saveSettings, type ThinkingLevelColor } from "./settings.ts";
import { announcesEmbedded, STATUSLINE_EMBED_CHANNEL } from "./statusline-embed.ts";
import { announceMissingToppingsOnce, type MissingToppingsEntryData, renderMissingToppingsEntry, SETUP_ENTRY_TYPE } from "./toppings.ts";
import { PreviewRenderer } from "./preview.ts";
import { buildCompletionMarkerContent, buildCompletionMarkerLine, PROMPT_BOX_TYPE, promptBoxRenderer, type PromptBoxDetails } from "./prompt-decorator.ts";
import { isPlainObject, modelsResemble, sanitizedText, stripControlChars } from "./util.ts";
import { formatServiceTierSummary, recordServiceTierCall, serviceTierCountsOf, serviceTierOf, type ServiceTierCount } from "./service-tier.ts";
import { servedModelOf } from "./served-model.ts";
import { loadBundledWordPacks, loadUserWordPacks, pickWorkingTextSelection, type WorkingTextSelection, type WordPack } from "./word-packs.ts";

type MessageStartEvent = Extract<ExtensionEvent, { type: "message_start" }>;
type MessageUpdateEvent = Extract<ExtensionEvent, { type: "message_update" }>;
type MessageEndEvent = Extract<ExtensionEvent, { type: "message_end" }>;
type ToolExecutionStartEvent = Extract<ExtensionEvent, { type: "tool_execution_start" }>;
type UIPromptStartEvent = Extract<ExtensionEvent, { type: "ui_prompt_start" }>;
type UIPromptEndEvent = Extract<ExtensionEvent, { type: "ui_prompt_end" }>;
type ProviderStreamEvent = Extract<ExtensionEvent, { type: "provider_stream_event" }>;
type UIPromptKind = UIPromptStartEvent["kind"];

const DONE_ENTRY_TYPE = "pi-topping-done";
const RESPONSE_MODEL_STATUS_KEY = "pi-topping-response-model";
/** Pi's `VIRTUAL_MODEL_API` for extension-registered virtual models; Pi does not export it from its public index. */
const VIRTUAL_MODEL_API = "pi-virtual";
const WAITING_LABELS: Record<UIPromptKind, string> = {
	select: "Waiting for selection",
	confirm: "Waiting for confirmation",
	input: "Waiting for input",
	editor: "Waiting in editor",
	custom: "Waiting for input",
};
const WAITING_PULSE_FRAMES = ["·", "•", "●", "•"];
const WAITING_PULSE_INTERVAL_MS = 120;
// Reconciliation resets the EMA at message boundaries, so retain and then fade the last rate to avoid flicker.
const TOKEN_RATE_HOLD_MS = 1_500;
const TOKEN_RATE_FADE_MS = 250;

interface DoneEntryData {
	word: string;
	elapsedMs: number;
	tokens?: number;
	midTurnInputs?: number;
	serviceTiers?: ServiceTierCount[];
	thinkingLevel?: ThinkingLevel;
	model?: string;
}

/** A response model as one source reports it, for `updateResponseModel`. */
interface ResponseModelReport {
	raw: unknown;
	/**
	 * True for a bare routed model id (a router announcement or, under a virtual selection, the
	 * message's `model`) rather than a provider-reported value. A weak value never displaces a
	 * decorated form of itself the provider already reported, such as a dated name.
	 */
	weak: boolean;
	/** The message's own provider when `raw` is its `model`, to recognize a failed route. */
	provider?: string;
	backend?: string;
}

interface SessionState {
	startTime: number;
	workingText: WorkingTextSelection;
	confirmTokens: number;
	liveTokens: number;
	shimmerOrigin: number;
	activityMeter: ActivityMeter;
	rateTracker: TokRateTracker;
	lastTokenRateSampledAt: number;
	lastTokenRateTotal: number;
	responseModel: string;
	responseModelServed: string;
	responseModelBackend: string;
	/** The backend companion to the last raw response-model report. */
	lastResponseModelBackend: string | undefined | typeof NOT_SENT;
	/** The tier reported by the in-flight provider call, added to counts at its assistant message_end. */
	pendingServiceTier: string;
	serviceTiers: ServiceTierCount[];
	/** Last raw responseModel value seen, or the NOT_SENT sentinel before the first call. */
	lastResponseModelRaw: unknown;
	responseModelHoldTimer: ReturnType<typeof setTimeout> | null;
	responseModelFadeTimer: ReturnType<typeof setInterval> | null;
	responseModelFadeGeneration: number;
	/** When the response model appeared in the loader and began sliding out; 0 if it never slid. */
	responseModelShownAt: number;
	responseModelSlideTimer: ReturnType<typeof setInterval> | null;
	tokenRateText: string;
	tokenRateFadeStartsAt: number;
	timer: ReturnType<typeof setInterval> | null;
	busy: boolean;
	waiting: { kind: UIPromptKind; title?: string } | null;
	midTurnInputs: number;
	/** Last string passed to setWorkingMessage(), or the NOT_SENT sentinel before the first call. */
	lastMessage: string | undefined | typeof NOT_SENT;
}

/** Sentinel distinguishing "never called setWorkingMessage()" from an explicit `undefined` message. */
const NOT_SENT = Symbol("not-sent");

/** Reset all token-rate tracking fields on `state` to their fresh-turn values. */
function resetTokenRateState(state: SessionState): void {
	state.rateTracker.reset();
	state.lastTokenRateSampledAt = 0;
	state.lastTokenRateTotal = 0;
	state.tokenRateText = "";
	state.tokenRateFadeStartsAt = 0;
}

function makeFreshState(): SessionState {
	return {
		startTime: 0,
		workingText: { text: "", pastTense: "Worked" },
		confirmTokens: 0,
		liveTokens: 0,
		shimmerOrigin: 0,
		activityMeter: new ActivityMeter(),
		rateTracker: new TokRateTracker(),
		lastTokenRateSampledAt: 0,
		lastTokenRateTotal: 0,
		responseModel: "",
		responseModelServed: "",
		responseModelBackend: "",
		lastResponseModelBackend: NOT_SENT,
		pendingServiceTier: "",
		serviceTiers: [],
		lastResponseModelRaw: NOT_SENT,
		responseModelHoldTimer: null,
		responseModelFadeTimer: null,
		responseModelFadeGeneration: 0,
		responseModelShownAt: 0,
		responseModelSlideTimer: null,
		tokenRateText: "",
		tokenRateFadeStartsAt: 0,
		timer: null,
		busy: false,
		waiting: null,
		midTurnInputs: 0,
		lastMessage: NOT_SENT,
	};
}

function waitingLabel(waiting: NonNullable<SessionState["waiting"]>): string {
	const title = waiting.title ? stripControlChars(waiting.title).trim() : "";
	return title ? `Waiting: ${title}` : WAITING_LABELS[waiting.kind];
}

/** Owns mutable extension state and Pi lifecycle registrations. */
export class SessionManager {
	#counter = new StreamingWordCounter();
	#state = makeFreshState();
	#settings = loadSettings();
	#userPacks: WordPack[] = [];
	#bundledPacks = loadBundledWordPacks();
	#allPacks: WordPack[] = [...this.#bundledPacks];
	#currentCtx: ExtensionContext | null = null;
	/** Whether pi-topping-statusline last announced that its status bar hosts the loader; kept across sessions. */
	#loaderInStatusline = false;
	readonly #pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.#pi = pi;
	}

	#onSessionStart = async (_e: SessionStartEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		this.stopTimer();
		this.stopResponseModelSlide();
		this.cancelResponseModelFade(ctx);
		this.#counter.reset();
		this.#state = makeFreshState();
		this.#settings = loadSettings();
		this.#userPacks = loadUserWordPacks();
		this.#allPacks = [...this.#bundledPacks, ...this.#userPacks];
		this.#state.activityMeter.setDirection(this.#settings.decorations.meterDirection);
		if (this.usable(ctx)) {
			this.applyIndicator(ctx);
			announceMissingToppingsOnce(this.#pi);
		}
	};

	#onInput = async (event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult | void> => {
		this.#currentCtx = ctx;
		if (!this.usable(ctx)) return;

		if (!event.streamingBehavior && !this.#state.busy) this.resetTurn(Date.now());
		else if (event.streamingBehavior && event.source !== "extension") this.#state.midTurnInputs++;
		if (this.#settings.decorations.decorateUserPrompt && this.shouldDecorate(event)) {
			try {
				await this.#pi.sendMessage<PromptBoxDetails>(
					{
						customType: PROMPT_BOX_TYPE,
						content: event.text,
						display: true,
						details: {
							submittedAt: Date.now(),
							showIcon: this.#settings.decorations.promptIcon,
							showTimestamp: this.#settings.decorations.promptTimestamp,
							showProvider: this.#settings.decorations.promptProvider,
							showModel: this.#settings.decorations.promptModel,
							icon: this.#settings.decorations.useNerdFont ? "" : "π",
							provider: ctx.model?.provider,
							model: ctx.model?.id,
							borderColor: this.#settings.decorations.borderColor,
							borderStyle: this.#settings.decorations.borderStyle,
							thinkingLevel: ctx.thinkingLevel,
						},
					},
					{ triggerTurn: true },
				);
				return { action: "handled" };
			} catch {
				ctx.ui.notify("Failed to submit prompt", "error");
				return;
			}
		}
	};

	#onAgentStart = async (_e: AgentStartEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		this.cancelResponseModelFade(ctx);
		if (!this.usable(ctx)) return;
		if (!this.#state.startTime) this.resetTurn(Date.now());
		this.#state.busy = true;
		if (!this.#state.waiting) this.applyIndicator(ctx);
		this.startTimer();
		this.tick();
	};

	#onMessageStart = async (event: MessageStartEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		if (this.usable(ctx) && event.message.role === "assistant") {
			this.#state.liveTokens = 0;
			this.#counter.reset();
			this.updateResponseModel(this.responseModelOf(event.message));
		}
	};

	#onMessageUpdate = async (event: MessageUpdateEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		if (!this.usable(ctx)) return;
		const assistantEvent = event.assistantMessageEvent;
		if (
			assistantEvent &&
			(assistantEvent.type === "text_delta" || assistantEvent.type === "thinking_delta")
		) {
			this.#state.liveTokens += this.#counter.count(assistantEvent.delta, assistantEvent.type);
		}
		const rawResponseModel = this.responseModelOf((assistantEvent as { partial?: unknown } | undefined)?.partial)
			?? this.responseModelOf(event.message);
		this.updateResponseModel(rawResponseModel);
	};

	#onMessageEnd = async (event: MessageEndEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		if (!this.usable(ctx) || event.message.role !== "assistant") return;
		this.commitServiceTierCall();

		const rawTokens = event.message.usage?.output;
		const exactTokens =
			typeof rawTokens === "number" && Number.isFinite(rawTokens) && rawTokens >= 0 ? rawTokens : undefined;
		this.#state.confirmTokens += exactTokens ?? this.#state.liveTokens;
		if (exactTokens !== undefined) {
			// Only reset the sampling state here, not tokenRateText/tokenRateFadeStartsAt:
			// those must keep holding/fading across message boundaries to avoid flicker.
			this.#state.rateTracker.reset();
			this.#state.lastTokenRateSampledAt = 0;
			this.#state.lastTokenRateTotal = this.#state.confirmTokens;
		}
		this.#state.liveTokens = 0;
		this.#counter.reset();
		this.updateResponseModel(this.responseModelOf(event.message));
	};

	#onProviderStreamEvent = (event: ProviderStreamEvent, ctx: ExtensionContext): void => {
		if (!this.usable(ctx) || !this.#state.busy) return;
		const tier = serviceTierOf(event.data);
		if (tier) this.#state.pendingServiceTier = tier;
		const served = servedModelOf(event.data);
		if (served) {
			this.updateResponseModel({ raw: served.model, weak: false, provider: event.provider, backend: served.backend });
		}
	};

	private commitServiceTierCall(): void {
		if (!this.#state.pendingServiceTier) return;
		recordServiceTierCall(this.#state.serviceTiers, this.#state.pendingServiceTier);
		this.#state.pendingServiceTier = "";
	}

	#onToolExecutionStart = async (_e: ToolExecutionStartEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		if (this.usable(ctx)) {
			this.#state.workingText = this.pickWorkingWord();
			this.#state.shimmerOrigin = Date.now();
			this.tick();
		}
	};

	#onUIPromptStart = (event: UIPromptStartEvent, ctx: ExtensionContext): void => {
		this.#currentCtx = ctx;
		if (!this.usable(ctx) || !this.#state.busy) return;
		this.#state.waiting = { kind: event.kind, title: event.title };
		this.applyWaitingIndicator(ctx);
		this.tick();
	};

	#onUIPromptEnd = (_event: UIPromptEndEvent, ctx: ExtensionContext): void => {
		this.#currentCtx = ctx;
		if (!this.usable(ctx) || !this.#state.waiting) return;
		this.#state.waiting = null;
		if (!this.#state.busy) return;
		this.applyIndicator(ctx);
		this.tick();
	};

	#onAgentSettled = async (_e: AgentSettledEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		if (!this.usable(ctx)) return;
		this.commitServiceTierCall();

		const hadPrompt = !!this.#state.startTime;
		const elapsedMs = hadPrompt ? Date.now() - this.#state.startTime : 0;
		const responseModel = this.#settings.features.responseModelFooter ? this.#state.responseModel : "";
		const responseModelColor = this.#settings.decorations.responseModelColor;
		const responseModelDimmed = this.#settings.decorations.responseModelDimmed;
		this.#state.busy = false;
		this.#state.waiting = null;
		this.#state.startTime = 0;
		this.#counter.reset();
		this.stopTimer();
		this.stopResponseModelSlide();
		this.applyIndicator(ctx);
		ctx.ui.setWorkingMessage();
		if (responseModel) this.startResponseModelFade(ctx, responseModel, responseModelColor, responseModelDimmed);
		this.#state.activityMeter.reset();
		resetTokenRateState(this.#state);
		this.#state.lastMessage = NOT_SENT;
		if (this.#settings.features.doneMarker && hadPrompt) {
			this.#pi.appendEntry<DoneEntryData>(DONE_ENTRY_TYPE, {
				word: this.#settings.features.randomizeDoneMarker ? this.#state.workingText.pastTense : "Worked",
				elapsedMs,
				tokens: this.#state.confirmTokens,
				midTurnInputs: this.#state.midTurnInputs,
				...(this.#state.serviceTiers.length ? { serviceTiers: this.#state.serviceTiers.map((count) => ({ ...count })) } : {}),
				thinkingLevel: ctx.thinkingLevel,
				model: this.#state.responseModel || undefined,
			});
		}
		this.#currentCtx = null;
	};

	#onSessionShutdown = async (_e: SessionShutdownEvent, ctx: ExtensionContext): Promise<void> => {
		this.#state.waiting = null;
		this.cancelResponseModelFade(ctx);
		this.stopTimer();
		this.stopResponseModelSlide();
	};

	#renderDoneEntry(entry: CustomEntry<DoneEntryData>, theme: Theme): Component | undefined {
		if (!entry.data) return undefined;
		const word = typeof entry.data.word === "string" ? stripControlChars(entry.data.word) : "Worked";
		const elapsedMs = typeof entry.data.elapsedMs === "number" && Number.isFinite(entry.data.elapsedMs) ? entry.data.elapsedMs : 0;
		const features = this.#settings.features;
		const details: string[] = [];
		if (features.doneMarkerTokens && typeof entry.data.tokens === "number" && Number.isFinite(entry.data.tokens) && entry.data.tokens >= 0) details.push(`↓ ${formatTokens(entry.data.tokens)} tokens`);
		if (features.doneMarkerInputs && typeof entry.data.midTurnInputs === "number" && Number.isInteger(entry.data.midTurnInputs) && entry.data.midTurnInputs > 0) {
			details.push(`${entry.data.midTurnInputs} mid-turn input${entry.data.midTurnInputs === 1 ? "" : "s"}`);
		}
		if (features.doneMarkerServiceTier) {
			const summary = formatServiceTierSummary(serviceTierCountsOf(entry.data.serviceTiers));
			if (summary) details.push(summary);
		}
		const icon = features.doneMarkerIcon ? theme.fg("text", this.#settings.decorations.useNerdFont ? "" : "π") : "";
		const thinkingLevel = isThinkingLevel(entry.data.thinkingLevel) ? entry.data.thinkingLevel : undefined;
		const rawModel = sanitizedText(entry.data.model);
		const modelColored = features.doneMarkerModel && rawModel
			? getThinkingLevelColorizer(theme, this.#settings.decorations.doneMarkerModelColor, thinkingLevel)(rawModel)
			: "";
		const model = modelColored && this.#settings.decorations.doneMarkerModelDimmed ? dimAttribute(modelColored) : modelColored;
		const markerContent = buildCompletionMarkerContent(theme, icon, word, formatElapsed(elapsedMs), details, model);
		const borderStyle = this.#settings.decorations.doneMarkerBorderStyle;
		const borderColor = this.#settings.decorations.doneMarkerBorderColor;
		const markerStyle = this.#settings.decorations.doneMarkerStyle;
		if (borderStyle === "none") return new Text(markerContent);

		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;
		return {
			render(width: number): string[] {
				if (cachedWidth !== width) {
					cachedWidth = width;
					cachedLines = ["", buildCompletionMarkerLine(markerContent, width, theme, borderStyle, borderColor, markerStyle, thinkingLevel), ""];
				}
				return cachedLines!;
			},
			invalidate(): void {
				cachedWidth = undefined;
				cachedLines = undefined;
			},
		} satisfies Component;
	}

	install(): void {
		this.#pi.on("session_start", this.#onSessionStart);
		this.#pi.on("input", this.#onInput);
		this.#pi.on("agent_start", this.#onAgentStart);
		this.#pi.on("message_start", this.#onMessageStart);
		this.#pi.on("message_update", this.#onMessageUpdate);
		this.#pi.on("message_end", this.#onMessageEnd);
		this.#pi.on("provider_stream_event", this.#onProviderStreamEvent);
		this.#pi.on("tool_execution_start", this.#onToolExecutionStart);
		this.#pi.on("agent_settled", this.#onAgentSettled);
		this.#pi.on("ui_prompt_start", this.#onUIPromptStart);
		this.#pi.on("ui_prompt_end", this.#onUIPromptEnd);
		this.#pi.on("session_shutdown", this.#onSessionShutdown);
		this.#pi.events.on(STATUSLINE_EMBED_CHANNEL, (data) => {
			this.#loaderInStatusline = announcesEmbedded(data);
		});
		this.#pi.events.on(ROUTED_MODEL_CHANNEL, (data) => {
			// Direct routes serve compaction and other extensions' side requests; a route while idle
			// is such a background request too, and must not leave a stale model for the next turn.
			const announcement = routedModelAnnouncement(data);
			if (!announcement || announcement.reason === "direct" || !this.#state.busy) return;
			this.updateResponseModel({ raw: announcement.modelId, weak: true, provider: announcement.provider });
		});
		this.#pi.registerEntryRenderer<DoneEntryData>(DONE_ENTRY_TYPE, (entry, _o, theme) => this.#renderDoneEntry(entry, theme));
		this.#pi.registerEntryRenderer<MissingToppingsEntryData>(SETUP_ENTRY_TYPE, (entry, _o, theme) => renderMissingToppingsEntry(entry, theme));
		this.#pi.registerMessageRenderer<PromptBoxDetails>(PROMPT_BOX_TYPE, promptBoxRenderer);
		this.#pi.registerCommand("topping-settings", {
			description: "Configure prompt decoration, working-loader features/order, and completion-marker settings.",
			handler: async (_a, ctx) => this.showSettings(ctx),
		});
		registerSetupCommand(this.#pi);
	}

	private usable(ctx: ExtensionContext): boolean {
		return !!ctx.hasUI && ctx.mode !== "print";
	}

	/**
	 * Mid-stream inputs (steer/follow-up) must pass through untouched: re-sending them via
	 * sendMessage(deliverAs) bypasses Pi's queue state, so the "Steering:"/"Follow-up:" rows
	 * below the editor never render (issue #2).
	 */
	private shouldDecorate(event: InputEvent): boolean {
		return (
			!event.streamingBehavior &&
			event.source !== "extension" &&
			!!event.text.trim() &&
			!event.images?.length &&
			!/^[\/!?:]/.test(event.text)
		);
	}

	/**
	 * Pi's Loader always prepends its indicator to the working message, so a spinner
	 * that is not the leading element has to be drawn inside the message instead.
	 */
	private spinnerInMessage(): boolean {
		return this.#settings.decorations.animatedSpinner && this.#settings.loaderOrder[0] !== "spinner";
	}

	private indicatorFingerprint(): string {
		const decorations = this.#settings.decorations;
		return `${decorations.animatedSpinner}:${decorations.spinnerColor}:${decorations.spinnerColorEnabled}:${this.#settings.loaderOrder[0]}`;
	}

	private applyWaitingIndicator(ctx: ExtensionContext): void {
		ctx.ui.setWorkingIndicator({
			frames: WAITING_PULSE_FRAMES.map((frame) => ctx.ui.theme.fg("dim", frame)),
			intervalMs: WAITING_PULSE_INTERVAL_MS,
		});
	}

	private applyIndicator(ctx: ExtensionContext): void {
		if (!this.#settings.decorations.animatedSpinner || this.spinnerInMessage()) {
			ctx.ui.setWorkingIndicator({ frames: [] });
			return;
		}

		const color = this.#settings.decorations.spinnerColor;
		ctx.ui.setWorkingIndicator({
			frames: SPINNER_FRAMES.map((frame) => getThinkingLevelColorizer(ctx.ui.theme, color, ctx.thinkingLevel)(frame)),
		});
	}

	private stopTimer(): void {
		if (this.#state.timer) {
			clearInterval(this.#state.timer);
			this.#state.timer = null;
		}
	}

	/**
	 * The response model a message reports. Under a virtual selection Pi stamps the routed
	 * physical model on the message's `model` instead, so fall back to that as a weak value;
	 * a failed route leaves the virtual model itself there, which `restatesSelection` hides.
	 */
	private responseModelOf(message: unknown): ResponseModelReport | undefined {
		if (!isPlainObject(message)) return undefined;
		if (message.responseModel !== undefined) return { raw: message.responseModel, weak: false };
		if (this.#currentCtx?.model?.api !== VIRTUAL_MODEL_API) return undefined;
		return { raw: message.model, weak: true, provider: typeof message.provider === "string" ? message.provider : undefined };
	}

	/**
	 * Whether a response model merely restates the selected model. Under a virtual selection
	 * the routed model is always another model, so only a failed route, which leaves the
	 * virtual model itself on the message, is hidden; a resemblance check would also hide a
	 * routed model whose id contains the virtual id, such as openrouter's `auto`.
	 */
	private restatesSelection(report: ResponseModelReport, responseModel: string): boolean {
		const selected = this.#currentCtx?.model;
		if (!selected) return false;
		if (selected.api === VIRTUAL_MODEL_API) return report.provider === selected.provider && responseModel === selected.id;
		return modelsResemble(selected.id, responseModel);
	}

	private updateResponseModel(report: ResponseModelReport | undefined): void {
		const backendReport = report?.backend;
		if (report?.raw === this.#state.lastResponseModelRaw && backendReport === this.#state.lastResponseModelBackend) return;
		this.#state.lastResponseModelRaw = report?.raw;
		this.#state.lastResponseModelBackend = backendReport;
		if (!report) return;
		const model = sanitizedText(report.raw);
		if (!model) return;
		const backend = report.backend ?? (model === this.#state.responseModelServed ? this.#state.responseModelBackend : "");
		const showBackend = !!backend && backend !== report.provider;
		const restates = this.restatesSelection(report, model);
		const display = restates ? (showBackend ? `via ${backend}` : "") : (showBackend ? `${model} via ${backend}` : model);
		if (!display) {
			if (this.#state.responseModel) {
				this.#state.responseModel = "";
				this.stopResponseModelSlide();
				this.tick();
			}
			this.#state.responseModelServed = "";
			this.#state.responseModelBackend = "";
			return;
		}
		if (display === this.#state.responseModel) {
			this.#state.responseModelServed = model;
			this.#state.responseModelBackend = backend;
			return;
		}
		// A bare routed id that the shown decorated form already contains would only flicker.
		if (report.weak && modelsResemble(model, this.#state.responseModelServed || this.#state.responseModel)) return;
		// A model replacing one already shown swaps in place; only an appearing one slides out.
		if (!this.#state.responseModel) this.startResponseModelSlide();
		this.#state.responseModel = display;
		this.#state.responseModelServed = model;
		this.#state.responseModelBackend = backend;
		this.tick();
	}

	/**
	 * Slide a newly shown response model out of the loader while pi-topping-statusline
	 * embeds it, matching that status bar's own slides; anywhere else it shows at once.
	 * The loader's own timer runs at 50ms or slower, so the slide repaints on its own
	 * faster timer until it is done.
	 */
	private startResponseModelSlide(): void {
		this.stopResponseModelSlide();
		const state = this.#state;
		if (!this.#settings.features.responseModel || !this.#loaderInStatusline) {
			state.responseModelShownAt = 0;
			return;
		}
		state.responseModelShownAt = Date.now();
		state.responseModelSlideTimer = setInterval(() => {
			this.tick();
			if (Date.now() - state.responseModelShownAt >= RESPONSE_MODEL_SLIDE_MS) this.stopResponseModelSlide();
		}, RESPONSE_MODEL_SLIDE_FRAME_MS);
	}

	private stopResponseModelSlide(): void {
		const state = this.#state;
		if (state.responseModelSlideTimer) {
			clearInterval(state.responseModelSlideTimer);
			state.responseModelSlideTimer = null;
		}
	}

	private cancelResponseModelFade(ctx?: ExtensionContext | null): void {
		const state = this.#state;
		state.responseModelFadeGeneration++;
		if (state.responseModelHoldTimer) {
			clearTimeout(state.responseModelHoldTimer);
			state.responseModelHoldTimer = null;
		}
		if (state.responseModelFadeTimer) {
			clearInterval(state.responseModelFadeTimer);
			state.responseModelFadeTimer = null;
		}
		const activeCtx = ctx ?? this.#currentCtx;
		if (activeCtx && this.usable(activeCtx)) {
			activeCtx.ui.setStatus(RESPONSE_MODEL_STATUS_KEY, undefined);
		}
	}

	private startResponseModelFade(ctx: ExtensionContext, model: string, color: ThinkingLevelColor, dimmed: boolean): void {
		this.cancelResponseModelFade(ctx);
		const generation = this.#state.responseModelFadeGeneration;
		const colorizer = getResponseModelColorizer(ctx.ui.theme, color, ctx.thinkingLevel, ctx.model?.provider);
		const render = (shade?: number): void => {
			const colored = shade === undefined
				? colorizer(model)
				: fadeThemeColorString(
					model,
					shade,
					ctx.ui.theme,
					colorizer,
				);
			const responseModel = dimmed ? dimAttribute(colored) : colored;
			ctx.ui.setStatus(RESPONSE_MODEL_STATUS_KEY, responseModel);
		};
		render();
		this.#state.responseModelHoldTimer = setTimeout(() => {
			if (this.#state.responseModelFadeGeneration !== generation) return;
			this.#state.responseModelHoldTimer = null;
			let shade = 0;
			render(shade++);
			this.#state.responseModelFadeTimer = setInterval(() => {
				if (this.#state.responseModelFadeGeneration !== generation) return;
				if (shade >= TOKEN_RATE_FADE_SHADE_COUNT) {
					this.cancelResponseModelFade(ctx);
					return;
				}
				render(shade++);
			}, RESPONSE_MODEL_FADE_MS / TOKEN_RATE_FADE_SHADE_COUNT);
		}, RESPONSE_MODEL_HOLD_MS);
	}

	private startTimer(): void {
		if (this.#state.timer) return;

		const features = this.#settings.features;
		const decorations = this.#settings.decorations;
		let interval: number | undefined;
		if (decorations.shimmer) interval = SHIMMER_INTERVAL_MS;
		else if (decorations.tokenActivityMonitor || features.outputTokens || features.tokenRate) interval = METER_INTERVAL_MS;
		else if (features.elapsedTime) interval = ELAPSED_INTERVAL_MS;
		if (this.spinnerInMessage()) interval = Math.min(interval ?? SPINNER_FRAME_MS, SPINNER_FRAME_MS);
		if (interval) this.#state.timer = setInterval(() => this.tick(), interval);
	}

	private pickWorkingWord(): WorkingTextSelection {
		return pickWorkingTextSelection(this.#settings.wordPacks, this.#allPacks, this.#settings.features.includeDefaultWorkingText);
	}

	private resetTurn(now: number): void {
		this.cancelResponseModelFade();
		this.stopResponseModelSlide();
		const state = this.#state;
		state.startTime = now;
		state.shimmerOrigin = now;
		state.workingText = this.pickWorkingWord();
		state.confirmTokens = 0;
		state.liveTokens = 0;
		state.responseModel = "";
		state.responseModelServed = "";
		state.responseModelBackend = "";
		state.pendingServiceTier = "";
		state.serviceTiers = [];
		state.lastResponseModelRaw = NOT_SENT;
		state.lastResponseModelBackend = NOT_SENT;
		state.activityMeter.reset();
		resetTokenRateState(state);
		state.midTurnInputs = 0;
		state.lastMessage = NOT_SENT;
		this.#counter.reset();
	}

	private tick(): void {
		const ctx = this.#currentCtx;
		const state = this.#state;
		if (!state.busy || !ctx) return;
		if (state.waiting) {
			const msg = ctx.ui.theme.fg("dim", waitingLabel(state.waiting));
			if (msg !== state.lastMessage) {
				state.lastMessage = msg;
				ctx.ui.setWorkingMessage(msg);
			}
			return;
		}

		const now = Date.now();
		const total = state.confirmTokens + state.liveTokens;
		const features = this.#settings.features;
		const decorations = this.#settings.decorations;
		let hasNewTokenCount = false;
		if ((decorations.tokenActivityMonitor || features.tokenRate) && now - state.lastTokenRateSampledAt >= METER_INTERVAL_MS) {
			// Do not reset the fade for an EMA-only decay while output is quiet.
			hasNewTokenCount = total > state.lastTokenRateTotal;
			state.lastTokenRateTotal = total;
			const tokenRate = state.rateTracker.sample(total, now);
			if (decorations.tokenActivityMonitor) state.activityMeter.push(rateToLevel(tokenRate, decorations.meterUpperBoundTps));
			state.lastTokenRateSampledAt = now;
		}
		const responseModelShown = features.responseModel && state.responseModel
			? slideOutTail(state.responseModel, now - state.responseModelShownAt)
			: "";
		if (features.tokenRate) {
			const latestTokenRate = formatTokenRate(state.rateTracker.tokenRate);
			if (latestTokenRate && hasNewTokenCount) {
				state.tokenRateText = latestTokenRate;
				state.tokenRateFadeStartsAt = now + TOKEN_RATE_HOLD_MS;
			} else if (now >= state.tokenRateFadeStartsAt + TOKEN_RATE_FADE_MS) {
				state.tokenRateText = "";
			}
		}
		const showSpinner = this.spinnerInMessage();
		const msg = isFullyDefaultAppearance(features, decorations) && !showSpinner && !responseModelShown
			? undefined
			: buildLoaderMessage(
				ctx.ui.theme,
				ctx.thinkingLevel,
				ctx.model?.provider,
				features,
				decorations,
				this.#settings.loaderOrder,
				{
					spinnerAtMs: showSpinner ? now : undefined,
					word: state.workingText.text,
					shimmerAtMs: now - state.shimmerOrigin,
					renderMeter: (colorizer, dimmed) => state.activityMeter.render((level, char) =>
						ActivityMeter.colorizeCell(level, char, ctx.ui.theme, colorizer, dimmed),
					),
					elapsedMs: now - state.startTime,
					outputTokens: total,
					tokenRateText: state.tokenRateText,
					tokenRateShade: now < state.tokenRateFadeStartsAt
						? undefined
						: Math.floor((now - state.tokenRateFadeStartsAt) / (TOKEN_RATE_FADE_MS / TOKEN_RATE_FADE_SHADE_COUNT)),
					responseModel: responseModelShown,
				},
			);
		if (msg !== state.lastMessage) {
			state.lastMessage = msg;
			ctx.ui.setWorkingMessage(msg);
		}
	}

	private async showSettings(ctx: ExtensionCommandContext): Promise<void> {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/topping-settings requires TUI mode", "error");
			return;
		}

		this.#userPacks = loadUserWordPacks();
		this.#allPacks = [...this.#bundledPacks, ...this.#userPacks];
		const before = this.indicatorFingerprint();
		const preview = new PreviewRenderer(ctx, this.#allPacks);
		const result = await showMenu<Record<string, boolean | string>>(ctx, {
			title: "Pi Topping: Settings",
			maxHeight: "75%",
			sections: buildMenuSections(this.#settings, this.#bundledPacks, this.#userPacks),
			hints: ["↑↓ move", "PgUp/PgDn page", "←→ select", "␣ toggle", "⏎ apply", "esc cancel"],
			preview: preview.render.bind(preview),
		});
		if (!result.applied) return;

		const updatedSettings = applyMenuResult(this.#settings, result.values);
		try {
			saveSettings(updatedSettings);
		} catch {
			ctx.ui.notify("Failed to save Pi Topping settings", "error");
			return;
		}

		this.#settings = updatedSettings;
		if (before !== this.indicatorFingerprint()) {
			if (this.#state.waiting) this.applyWaitingIndicator(ctx);
			else this.applyIndicator(ctx);
		}
		this.#state.activityMeter.setDirection(this.#settings.decorations.meterDirection);
		if (this.#state.busy) {
			this.stopTimer();
			this.startTimer();
			this.tick();
		}
		ctx.ui.notify("Pi Topping settings saved", "info");
	}
}
