import type {
	AgentSettledEvent,
	AgentStartEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionEvent,
	InputEvent,
	InputEventResult,
	SessionShutdownEvent,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { ActivityMeter, rateToLevel, TokRateTracker } from "./activity-meter.ts";
import {
	buildWorkingMessage,
	DEFAULT_WORKING_WORD,
	fadeThemeColorString,
	formatElapsed,
	formatTokenRate,
	formatTokens,
	isFullyDefaultAppearance,
	METER_INTERVAL_MS,
	shimmerString,
	SPINNER_FRAME_MS,
	SPINNER_FRAMES,
	TOKEN_RATE_FADE_SHADE_COUNT,
	TOKEN_RATE_PLACEHOLDER,
	StreamingWordCounter,
} from "./format.ts";
import { showMenu } from "./menu.ts";
import { applyMenuResult, buildMenuSections, loadSettings, saveSettings, type SettingColor } from "./settings.ts";
import { PreviewRenderer } from "./preview.ts";
import { PROMPT_BOX_TYPE, promptBoxRenderer, type PromptBoxDetails } from "./prompt-decorator.ts";
import { pickRandomWord, pickRawWord } from "./words.ts";

type MessageStartEvent = Extract<ExtensionEvent, { type: "message_start" }>;
type MessageUpdateEvent = Extract<ExtensionEvent, { type: "message_update" }>;
type MessageEndEvent = Extract<ExtensionEvent, { type: "message_end" }>;
type ToolExecutionStartEvent = Extract<ExtensionEvent, { type: "tool_execution_start" }>;

const DONE_ENTRY_TYPE = "pi-topping-done";
const SHIMMER_INTERVAL_MS = 50;
const ELAPSED_INTERVAL_MS = 1_000;
// Reconciliation resets the EMA at message boundaries, so retain and then fade the last rate to avoid flicker.
const TOKEN_RATE_HOLD_MS = 1_500;
const TOKEN_RATE_FADE_MS = 250;

export interface DoneEntryData {
	word: string;
	elapsedMs: number;
	tokens?: number;
	midTurnInputs?: number;
}

export interface SessionState {
	startTime: number;
	currentWord: string;
	confirmTokens: number;
	liveTokens: number;
	shimmerOrigin: number;
	activityMeter: ActivityMeter;
	rateTracker: TokRateTracker;
	lastTokenRateSampledAt: number;
	lastTokenRateTotal: number;
	tokenRateText: string;
	tokenRateFadeStartsAt: number;
	timer: ReturnType<typeof setInterval> | null;
	busy: boolean;
	midTurnInputs: number;
}

export function makeFreshState(): SessionState {
	return {
		startTime: 0,
		currentWord: "",
		confirmTokens: 0,
		liveTokens: 0,
		shimmerOrigin: 0,
		activityMeter: new ActivityMeter(),
		rateTracker: new TokRateTracker(),
		lastTokenRateSampledAt: 0,
		lastTokenRateTotal: 0,
		tokenRateText: "",
		tokenRateFadeStartsAt: 0,
		timer: null,
		busy: false,
		midTurnInputs: 0,
	};
}

/** Owns mutable extension state and Pi lifecycle registrations. */
export class SessionManager {
	#counter = new StreamingWordCounter();
	#state = makeFreshState();
	#settings = loadSettings();
	#currentCtx: ExtensionContext | null = null;
	readonly #pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.#pi = pi;
	}

	#onSessionStart = async (_e: SessionStartEvent, ctx: ExtensionContext): Promise<void> => {
		this.stopTimer();
		this.#counter.reset();
		this.#state = makeFreshState();
		this.#settings = loadSettings();
		this.#state.activityMeter.setDirection(this.#settings.decorations.meterDirection);
		this.#currentCtx = ctx;
		if (this.usable(ctx)) this.applyIndicator(ctx);
	};

	#onInput = async (event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult | void> => {
		this.#currentCtx = ctx;
		if (!this.usable(ctx)) return;

		if (!event.streamingBehavior && !this.#state.busy) this.resetTurn(Date.now());
		else if (event.streamingBehavior && event.source !== "extension") this.#state.midTurnInputs++;
		if (this.#settings.decorations.decorateUserPrompt && this.shouldDecorate(event)) {
			this.#pi.sendMessage<PromptBoxDetails>(
				{
					customType: PROMPT_BOX_TYPE,
					content: event.text,
					display: true,
					details: {
						submittedAt: Date.now(),
						showIcon: this.#settings.decorations.promptIcon,
						showTimestamp: this.#settings.decorations.promptTimestamp,
						icon: this.#settings.decorations.useNerdFont ? "" : "π",
						borderColor: this.#settings.decorations.borderColor,
						borderStyle: this.#settings.decorations.borderStyle,
					},
				},
				{
					triggerTurn: true,
					...(event.streamingBehavior ? { deliverAs: event.streamingBehavior } : {}),
				},
			);
			return { action: "handled" };
		}
	};

	#onAgentStart = async (_e: AgentStartEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		if (!this.usable(ctx)) return;
		if (!this.#state.startTime) this.resetTurn(Date.now());
		this.#state.busy = true;
		this.startTimer();
		this.tick();
	};

	#onMessageStart = async (event: MessageStartEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		if (this.usable(ctx) && event.message.role === "assistant") {
			this.#state.liveTokens = 0;
			this.#counter.reset();
		}
	};

	#onMessageUpdate = async (event: MessageUpdateEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		const assistantEvent = event.assistantMessageEvent;
		if (
			this.usable(ctx) &&
			assistantEvent &&
			(assistantEvent.type === "text_delta" || assistantEvent.type === "thinking_delta")
		) {
			this.#state.liveTokens += this.#counter.count(assistantEvent.delta, assistantEvent.type);
		}
	};

	#onMessageEnd = async (event: MessageEndEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		if (!this.usable(ctx) || event.message.role !== "assistant") return;

		const exactTokens = event.message.usage?.output;
		this.#state.confirmTokens += exactTokens ?? this.#state.liveTokens;
		if (exactTokens !== undefined) {
			this.#state.rateTracker.reset();
			this.#state.lastTokenRateSampledAt = 0;
			this.#state.lastTokenRateTotal = this.#state.confirmTokens;
		}
		this.#state.liveTokens = 0;
		this.#counter.reset();
	};

	#onToolExecutionStart = async (_e: ToolExecutionStartEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		if (this.usable(ctx)) {
			this.#state.currentWord = pickRandomWord();
			this.#state.shimmerOrigin = Date.now();
			this.tick();
		}
	};

	#onAgentSettled = async (_e: AgentSettledEvent, ctx: ExtensionContext): Promise<void> => {
		this.#currentCtx = ctx;
		if (!this.usable(ctx)) return;

		const hadPrompt = !!this.#state.startTime;
		const elapsedMs = hadPrompt ? Date.now() - this.#state.startTime : 0;
		this.#state.busy = false;
		this.#state.startTime = 0;
		this.#counter.reset();
		this.stopTimer();
		ctx.ui.setWorkingMessage();
		this.applyIndicator(ctx);
		this.#state.activityMeter.reset();
		this.#state.rateTracker.reset();
		this.#state.lastTokenRateSampledAt = 0;
		this.#state.lastTokenRateTotal = 0;
		this.#state.tokenRateText = "";
		this.#state.tokenRateFadeStartsAt = 0;
		if (this.#settings.features.doneMarker && hadPrompt) {
			this.#pi.appendEntry<DoneEntryData>(DONE_ENTRY_TYPE, {
				word: this.#settings.features.randomizeDoneMarker ? pickRawWord().past_tense : "Worked",
				elapsedMs,
				tokens: this.#state.confirmTokens,
				midTurnInputs: this.#state.midTurnInputs,
			});
		}
		this.#currentCtx = null;
	};

	#onSessionShutdown = async (_e: SessionShutdownEvent, _ctx: ExtensionContext): Promise<void> => {
		this.stopTimer();
	};

	install(): void {
		this.#pi.on("session_start", this.#onSessionStart);
		this.#pi.on("input", this.#onInput);
		this.#pi.on("agent_start", this.#onAgentStart);
		this.#pi.on("message_start", this.#onMessageStart);
		this.#pi.on("message_update", this.#onMessageUpdate);
		this.#pi.on("message_end", this.#onMessageEnd);
		this.#pi.on("tool_execution_start", this.#onToolExecutionStart);
		this.#pi.on("agent_settled", this.#onAgentSettled);
		this.#pi.on("session_shutdown", this.#onSessionShutdown);
		this.#pi.registerEntryRenderer<DoneEntryData>(DONE_ENTRY_TYPE, (entry, _o, theme) => {
			if (!entry.data) return undefined;
			const features = this.#settings.features;
			const details: string[] = [];
			if (features.doneMarkerTokens && entry.data.tokens !== undefined) details.push(`↓ ${formatTokens(entry.data.tokens)} tokens`);
			if (features.doneMarkerInputs && entry.data.midTurnInputs) {
				details.push(`${entry.data.midTurnInputs} mid-turn input${entry.data.midTurnInputs === 1 ? "" : "s"}`);
			}
			const tail = details.length ? ` (${details.join(" · ")})` : "";
			const icon = features.doneMarkerIcon ? theme.fg("text", this.#settings.decorations.useNerdFont ? "" : "π") : "";
			const summary = theme.fg("dim", `${features.doneMarkerIcon ? " " : ""}${entry.data.word} for ${formatElapsed(entry.data.elapsedMs)}${tail}`);
			return new Text(icon + summary);
		});
		this.#pi.registerMessageRenderer<PromptBoxDetails>(PROMPT_BOX_TYPE, promptBoxRenderer);
		this.#pi.registerCommand("topping-settings", {
			description: "Configure pi-topping's spinner, shimmer, activity meter, and message details.",
			handler: async (_a, ctx) => this.showSettings(ctx),
		});
	}

	private usable(ctx: ExtensionContext): boolean {
		return !!ctx.hasUI && ctx.mode !== "print";
	}

	private shouldDecorate(event: InputEvent): boolean {
		return event.source !== "extension" && !!event.text.trim() && !event.images?.length && !/^[\/!?:]/.test(event.text);
	}

	/**
	 * Pi's Loader always prepends its indicator to the working message, so a spinner
	 * that is not the leading element has to be drawn inside the message instead.
	 */
	private spinnerInMessage(): boolean {
		return this.#settings.decorations.animatedSpinner && this.#settings.loaderOrder[0] !== "spinner";
	}

	private spinnerColor(): SettingColor {
		const decorations = this.#settings.decorations;
		return decorations.spinnerColorEnabled ? decorations.spinnerColor : "accent";
	}

	private indicatorFingerprint(): string {
		const decorations = this.#settings.decorations;
		return `${decorations.animatedSpinner}:${decorations.spinnerColor}:${decorations.spinnerColorEnabled}:${this.#settings.loaderOrder[0]}`;
	}

	private applyIndicator(ctx: ExtensionContext): void {
		if (!this.#settings.decorations.animatedSpinner || this.spinnerInMessage()) {
			ctx.ui.setWorkingIndicator({ frames: [] });
			return;
		}

		const color = this.spinnerColor();
		if (color === "accent") {
			ctx.ui.setWorkingIndicator(undefined);
			return;
		}
		ctx.ui.setWorkingIndicator({ frames: SPINNER_FRAMES.map((frame) => ctx.ui.theme.fg(color, frame)) });
	}

	private stopTimer(): void {
		if (this.#state.timer) {
			clearInterval(this.#state.timer);
			this.#state.timer = null;
		}
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

	private resetTurn(now: number): void {
		const state = this.#state;
		state.startTime = now;
		state.shimmerOrigin = now;
		state.currentWord = pickRandomWord();
		state.confirmTokens = 0;
		state.liveTokens = 0;
		state.activityMeter.reset();
		state.rateTracker.reset();
		state.lastTokenRateSampledAt = 0;
		state.lastTokenRateTotal = 0;
		state.tokenRateText = "";
		state.tokenRateFadeStartsAt = 0;
		state.midTurnInputs = 0;
		this.#counter.reset();
	}

	private tick(): void {
		const ctx = this.#currentCtx;
		const state = this.#state;
		if (!state.busy || !ctx) return;

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
			? ctx.ui.theme.fg(this.spinnerColor(), SPINNER_FRAMES[Math.floor(now / SPINNER_FRAME_MS) % SPINNER_FRAMES.length]!)
			: "";
		if (isFullyDefaultAppearance(features, decorations)) {
			ctx.ui.setWorkingMessage(
				spinner
					? buildWorkingMessage(ctx.ui.theme, { spinner, text: ctx.ui.theme.fg("dim", DEFAULT_WORKING_WORD) }, this.#settings.loaderOrder)
					: undefined,
			);
			return;
		}

		const word = features.substituteDefaultMessage ? state.currentWord : DEFAULT_WORKING_WORD;
		const styled = decorations.shimmer
			? shimmerString(word, now - state.shimmerOrigin, ctx.ui.theme, decorations.shimmerDirection, decorations.shimmerSpeed)
			: ctx.ui.theme.fg("text", word);
		const meter = decorations.tokenActivityMonitor
			? state.activityMeter.render((level, char) =>
				ActivityMeter.colorizeCell(
					level,
					char,
					ctx.ui.theme,
					decorations.meterColorEnabled ? decorations.meterColor : "accent",
					decorations.meterDimmed,
				),
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
		const tokenRateSegment = !features.tokenRate
			? ""
			: !tokenRateText
				? ctx.ui.theme.fg("dim", TOKEN_RATE_PLACEHOLDER)
				: now < state.tokenRateFadeStartsAt
					? ctx.ui.theme.fg(decorations.tokenRateColor, tokenRateText)
					: fadeThemeColorString(
						tokenRateText,
						Math.floor((now - state.tokenRateFadeStartsAt) / (TOKEN_RATE_FADE_MS / TOKEN_RATE_FADE_SHADE_COUNT)),
						ctx.ui.theme,
						decorations.tokenRateColor,
					);
		const tokenRateStyled = tokenRateSegment && decorations.tokenRateDimmed ? `\x1b[2m${tokenRateSegment}\x1b[22m` : tokenRateSegment;
		ctx.ui.setWorkingMessage(
			buildWorkingMessage(
				ctx.ui.theme,
				{
					spinner,
					text: styled,
					meter,
					elapsed: features.elapsedTime ? formatElapsed(now - state.startTime) : "",
					tokens: features.outputTokens ? `↓ ${formatTokens(total)} tokens` : "",
					tokenRate: tokenRateStyled,
				},
				this.#settings.loaderOrder,
			),
		);
	}

	private async showSettings(ctx: ExtensionCommandContext): Promise<void> {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/topping-settings requires TUI mode", "error");
			return;
		}

		const before = this.indicatorFingerprint();
		const preview = new PreviewRenderer(ctx);
		const result = await showMenu<Record<string, boolean | string>>(ctx, {
			title: "Pi Topping: Settings",
			sections: buildMenuSections(this.#settings),
			hints: ["↑↓ move", "←→ select", "␣ toggle", "⏎ apply", "esc cancel"],
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
		if (before !== this.indicatorFingerprint()) this.applyIndicator(ctx);
		this.#state.activityMeter.setDirection(this.#settings.decorations.meterDirection);
		if (this.#state.busy) {
			this.stopTimer();
			this.startTimer();
			this.tick();
		}
		ctx.ui.notify("Pi Topping settings saved", "info");
	}
}
