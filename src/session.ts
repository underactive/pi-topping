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
import {
	buildWorkingMessage,
	DEFAULT_WORKING_WORD,
	dimAttribute,
	getThinkingLevelColorizer,
	ELAPSED_INTERVAL_MS,
	fadeThemeColorString,
	formatElapsed,
	formatTokenRate,
	formatTokens,
	isFullyDefaultAppearance,
	METER_INTERVAL_MS,
	RESPONSE_MODEL_FADE_MS,
	RESPONSE_MODEL_HOLD_MS,
	SHIMMER_INTERVAL_MS,
	shimmerString,
	SPINNER_FRAME_MS,
	SPINNER_FRAMES,
	TOKEN_RATE_FADE_SHADE_COUNT,
	TOKEN_RATE_PLACEHOLDER,
	StreamingWordCounter,
	type ThinkingLevel,
} from "./format.ts";
import { isSiblingSetupEnabled } from "./flags.ts";
import { showMenu } from "./menu.ts";
import { registerSetupCommand } from "./setup-command.ts";
import { applyMenuResult, buildMenuSections, loadSettings, saveSettings, type SpinnerColor, type ThinkingLevelColor } from "./settings.ts";
import { notifyMissingToppingsOnce } from "./toppings.ts";
import { PreviewRenderer } from "./preview.ts";
import { buildCompletionMarkerContent, buildCompletionMarkerLine, PROMPT_BOX_TYPE, promptBoxRenderer, type PromptBoxDetails } from "./prompt-decorator.ts";
import { modelsResemble, stripControlChars } from "./util.ts";
import { loadBundledWordPacks, loadUserWordPacks, pickWorkingTextSelection, type WorkingTextSelection, type WordPack } from "./word-packs.ts";

type MessageStartEvent = Extract<ExtensionEvent, { type: "message_start" }>;
type MessageUpdateEvent = Extract<ExtensionEvent, { type: "message_update" }>;
type MessageEndEvent = Extract<ExtensionEvent, { type: "message_end" }>;
type ToolExecutionStartEvent = Extract<ExtensionEvent, { type: "tool_execution_start" }>;
type UIPromptStartEvent = Extract<ExtensionEvent, { type: "ui_prompt_start" }>;
type UIPromptEndEvent = Extract<ExtensionEvent, { type: "ui_prompt_end" }>;
type UIPromptKind = UIPromptStartEvent["kind"];

const DONE_ENTRY_TYPE = "pi-topping-done";
const RESPONSE_MODEL_STATUS_KEY = "pi-topping-response-model";
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
	thinkingLevel?: ThinkingLevel;
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
	/** Last raw responseModel value seen, or the NOT_SENT sentinel before the first call. */
	lastResponseModelRaw: unknown;
	responseModelHoldTimer: ReturnType<typeof setTimeout> | null;
	responseModelFadeTimer: ReturnType<typeof setInterval> | null;
	responseModelFadeGeneration: number;
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
		lastResponseModelRaw: NOT_SENT,
		responseModelHoldTimer: null,
		responseModelFadeTimer: null,
		responseModelFadeGeneration: 0,
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
	readonly #pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.#pi = pi;
	}

	#onSessionStart = async (_e: SessionStartEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		this.stopTimer();
		this.cancelResponseModelFade(ctx);
		this.#counter.reset();
		this.#state = makeFreshState();
		this.#settings = loadSettings();
		this.#userPacks = loadUserWordPacks();
		this.#allPacks = [...this.#bundledPacks, ...this.#userPacks];
		this.#state.activityMeter.setDirection(this.#settings.decorations.meterDirection);
		if (this.usable(ctx)) {
			this.applyIndicator(ctx);
			if (isSiblingSetupEnabled()) notifyMissingToppingsOnce(this.#pi, ctx.ui);
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
			this.updateResponseModel((event.message as { responseModel?: unknown }).responseModel);
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
		const rawResponseModel = (assistantEvent as { partial?: { responseModel?: unknown } } | undefined)?.partial?.responseModel
			?? (event.message as { responseModel?: unknown } | undefined)?.responseModel;
		this.updateResponseModel(rawResponseModel);
	};

	#onMessageEnd = async (event: MessageEndEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		if (!this.usable(ctx) || event.message.role !== "assistant") return;

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
		this.updateResponseModel((event.message as { responseModel?: unknown }).responseModel);
	};

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

		const hadPrompt = !!this.#state.startTime;
		const elapsedMs = hadPrompt ? Date.now() - this.#state.startTime : 0;
		const responseModel = this.#settings.features.responseModel ? this.#state.responseModel : "";
		const responseModelColor = this.#settings.decorations.responseModelColor;
		const responseModelDimmed = this.#settings.decorations.responseModelDimmed;
		this.#state.busy = false;
		this.#state.waiting = null;
		this.#state.startTime = 0;
		this.#counter.reset();
		this.stopTimer();
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
				thinkingLevel: ctx.thinkingLevel,
			});
		}
		this.#currentCtx = null;
	};

	#onSessionShutdown = async (_e: SessionShutdownEvent, ctx: ExtensionContext): Promise<void> => {
		this.#state.waiting = null;
		this.cancelResponseModelFade(ctx);
		this.stopTimer();
	};

	#renderDoneEntry(entry: CustomEntry<DoneEntryData>, theme: Theme): Component | undefined {
		if (!entry.data) return undefined;
		const word = typeof entry.data.word === "string" ? stripControlChars(entry.data.word) : "Worked";
		const elapsedMs = typeof entry.data.elapsedMs === "number" && Number.isFinite(entry.data.elapsedMs) ? entry.data.elapsedMs : 0;
		const features = this.#settings.features;
		const details: string[] = [];
		if (features.doneMarkerTokens && typeof entry.data.tokens === "number") details.push(`↓ ${formatTokens(entry.data.tokens)} tokens`);
		if (features.doneMarkerInputs && typeof entry.data.midTurnInputs === "number" && entry.data.midTurnInputs) {
			details.push(`${entry.data.midTurnInputs} mid-turn input${entry.data.midTurnInputs === 1 ? "" : "s"}`);
		}
		const icon = features.doneMarkerIcon ? theme.fg("text", this.#settings.decorations.useNerdFont ? "" : "π") : "";
		const markerContent = buildCompletionMarkerContent(theme, icon, word, formatElapsed(elapsedMs), details);
		const borderStyle = this.#settings.decorations.doneMarkerBorderStyle;
		const borderColor = this.#settings.decorations.doneMarkerBorderColor;
		const markerStyle = this.#settings.decorations.doneMarkerStyle;
		const thinkingLevel = entry.data.thinkingLevel;
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
		this.#pi.on("tool_execution_start", this.#onToolExecutionStart);
		this.#pi.on("agent_settled", this.#onAgentSettled);
		this.#pi.on("ui_prompt_start", this.#onUIPromptStart);
		this.#pi.on("ui_prompt_end", this.#onUIPromptEnd);
		this.#pi.on("session_shutdown", this.#onSessionShutdown);
		this.#pi.registerEntryRenderer<DoneEntryData>(DONE_ENTRY_TYPE, (entry, _o, theme) => this.#renderDoneEntry(entry, theme));
		this.#pi.registerMessageRenderer<PromptBoxDetails>(PROMPT_BOX_TYPE, promptBoxRenderer);
		this.#pi.registerCommand("topping-settings", {
			description: "Configure prompt decoration, working-loader features/order, and completion-marker settings.",
			handler: async (_a, ctx) => this.showSettings(ctx),
		});
		if (isSiblingSetupEnabled()) registerSetupCommand(this.#pi);
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

	private spinnerColor(): SpinnerColor {
		const decorations = this.#settings.decorations;
		return decorations.spinnerColorEnabled ? decorations.spinnerColor : "thinking-level";
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

		const color = this.spinnerColor();
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

	private updateResponseModel(raw: unknown): void {
		if (raw === this.#state.lastResponseModelRaw) return;
		this.#state.lastResponseModelRaw = raw;
		const responseModel = typeof raw === "string" ? stripControlChars(raw).trim() : "";
		const selectedModel = this.#currentCtx?.model?.id;
		if (responseModel && modelsResemble(selectedModel, responseModel)) {
			if (this.#state.responseModel) {
				this.#state.responseModel = "";
				this.tick();
			}
			return;
		}
		if (responseModel && responseModel !== this.#state.responseModel) {
			this.#state.responseModel = responseModel;
			this.tick();
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
		const colorizer = getThinkingLevelColorizer(ctx.ui.theme, color, ctx.thinkingLevel);
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
		return pickWorkingTextSelection(this.#settings.wordPacks, this.#allPacks);
	}

	private resetTurn(now: number): void {
		this.cancelResponseModelFade();
		const state = this.#state;
		state.startTime = now;
		state.shimmerOrigin = now;
		state.workingText = this.pickWorkingWord();
		state.confirmTokens = 0;
		state.liveTokens = 0;
		state.responseModel = "";
		state.lastResponseModelRaw = NOT_SENT;
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
			if (decorations.tokenActivityMonitor) state.activityMeter.push(rateToLevel(tokenRate));
			state.lastTokenRateSampledAt = now;
		}
		const spinner = this.spinnerInMessage()
			? getThinkingLevelColorizer(ctx.ui.theme, this.spinnerColor(), ctx.thinkingLevel)(SPINNER_FRAMES[Math.floor(now / SPINNER_FRAME_MS) % SPINNER_FRAMES.length]!)
			: "";
		const responseModelColorizer = getThinkingLevelColorizer(ctx.ui.theme, decorations.responseModelColor, ctx.thinkingLevel);
		const responseModelColored = features.responseModel && state.responseModel
			? responseModelColorizer(state.responseModel)
			: "";
		const responseModel = responseModelColored && decorations.responseModelDimmed ? dimAttribute(responseModelColored) : responseModelColored;
		if (isFullyDefaultAppearance(features, decorations)) {
			const msg = spinner || responseModel
				? buildWorkingMessage(ctx.ui.theme, { spinner, text: ctx.ui.theme.fg("dim", DEFAULT_WORKING_WORD), responseModel }, this.#settings.loaderOrder)
				: undefined;
			if (msg !== state.lastMessage) {
				state.lastMessage = msg;
				ctx.ui.setWorkingMessage(msg);
			}
			return;
		}

		const word = features.substituteDefaultMessage ? state.workingText.text : DEFAULT_WORKING_WORD;
		const styled = decorations.shimmer
			? shimmerString(word, now - state.shimmerOrigin, ctx.ui.theme, decorations.shimmerDirection, decorations.shimmerSpeed, decorations.shimmerInverted)
			: ctx.ui.theme.fg("text", word);
		const meterColorizer = getThinkingLevelColorizer(
			ctx.ui.theme,
			decorations.meterColorEnabled ? decorations.meterColor : "accent",
			ctx.thinkingLevel,
		);
		const meter = decorations.tokenActivityMonitor
			? state.activityMeter.render((level, char) =>
				ActivityMeter.colorizeCell(level, char, ctx.ui.theme, meterColorizer, decorations.meterDimmed),
			)
			: "";
		let tokenRateText = "";
		if (features.tokenRate) {
			const latestTokenRate = formatTokenRate(state.rateTracker.tokenRate);
			if (latestTokenRate && hasNewTokenCount) {
				state.tokenRateText = latestTokenRate;
				state.tokenRateFadeStartsAt = now + TOKEN_RATE_HOLD_MS;
			} else if (now >= state.tokenRateFadeStartsAt + TOKEN_RATE_FADE_MS) {
				state.tokenRateText = "";
			}
			tokenRateText = state.tokenRateText;
		}
		const tokenRateColorizer = getThinkingLevelColorizer(ctx.ui.theme, decorations.tokenRateColor, ctx.thinkingLevel);
		const tokenRateSegment = !features.tokenRate
			? ""
			: !tokenRateText
				? ctx.ui.theme.fg("dim", TOKEN_RATE_PLACEHOLDER)
				: now < state.tokenRateFadeStartsAt
					? tokenRateColorizer(tokenRateText)
					: fadeThemeColorString(
						tokenRateText,
						Math.floor((now - state.tokenRateFadeStartsAt) / (TOKEN_RATE_FADE_MS / TOKEN_RATE_FADE_SHADE_COUNT)),
						ctx.ui.theme,
						tokenRateColorizer,
					);
		const tokenRateStyled = tokenRateSegment && decorations.tokenRateDimmed ? dimAttribute(tokenRateSegment) : tokenRateSegment;
		const msg = buildWorkingMessage(
			ctx.ui.theme,
			{
				spinner,
				text: styled,
				meter,
				elapsed: features.elapsedTime ? formatElapsed(now - state.startTime) : "",
				tokens: features.outputTokens ? `↓ ${formatTokens(total)} tokens` : "",
				tokenRate: tokenRateStyled,
				responseModel,
			},
			this.#settings.loaderOrder,
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
		const preview = new PreviewRenderer(ctx, [...this.#bundledPacks, ...this.#userPacks]);
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
