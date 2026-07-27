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
	formatElapsed,
	formatTokens,
	isFullyDefaultAppearance,
	shimmerString,
	SPINNER_FRAMES,
	StreamingWordCounter,
} from "./format.ts";
import { showMenu } from "./menu.ts";
import { applyMenuResult, buildMenuSections, loadSettings, saveSettings } from "./settings.ts";
import { PreviewRenderer } from "./preview.ts";
import { PROMPT_BOX_TYPE, promptBoxRenderer, type PromptBoxDetails } from "./prompt-decorator.ts";
import { pickRandomWord, pickRawWord } from "./words.ts";

type MessageStartEvent = Extract<ExtensionEvent, { type: "message_start" }>;
type MessageUpdateEvent = Extract<ExtensionEvent, { type: "message_update" }>;
type MessageEndEvent = Extract<ExtensionEvent, { type: "message_end" }>;
type ToolExecutionStartEvent = Extract<ExtensionEvent, { type: "tool_execution_start" }>;

const DONE_ENTRY_TYPE = "pi-topping-done";
const DEFAULT_WORKING_WORD = "Working…";
const SHIMMER_INTERVAL = 50;
const METER_INTERVAL_MS = 100;
const ELAPSED_INTERVAL_MS = 1_000;

export interface DoneEntryData {
	word: string;
	elapsedMs: number;
	tokens: number;
}

export interface SessionState {
	startTime: number;
	currentWord: string;
	confirmTokens: number;
	liveTokens: number;
	shimmerOrigin: number;
	activityMeter: ActivityMeter;
	rateTracker: TokRateTracker;
	lastActivityMeterUpdate: number;
	timer: ReturnType<typeof setInterval> | null;
	busy: boolean;
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
		lastActivityMeterUpdate: 0,
		timer: null,
		busy: false,
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
		this.#currentCtx = null;
		this.#state = makeFreshState();
		this.#settings = loadSettings();
		this.#state.activityMeter.setDirection(this.#settings.decorations.meterDirection);
		this.#currentCtx = ctx;
		if (this.usable(ctx)) this.applyIndicator(ctx);
	};

	#onInput = async (event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult | void> => {
		this.#currentCtx = ctx;
		if (!this.usable(ctx)) return;

		this.resetTurn(Date.now());
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
			this.#state.lastActivityMeterUpdate = 0;
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
		this.#state.lastActivityMeterUpdate = 0;
		if (this.#settings.features.doneMarker && hadPrompt) {
			this.#pi.appendEntry<DoneEntryData>(DONE_ENTRY_TYPE, {
				word: this.#settings.features.randomizeDoneMarker ? pickRawWord().past_tense : "Worked",
				elapsedMs,
				tokens: this.#state.confirmTokens,
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
		this.#pi.registerEntryRenderer<DoneEntryData>(DONE_ENTRY_TYPE, (entry, _o, theme) =>
			entry.data
				? new Text(
					`${this.#settings.features.doneMarkerIcon ? theme.fg("text", this.#settings.decorations.useNerdFont ? "" : "π") : ""}${theme.fg("dim", `${this.#settings.features.doneMarkerIcon ? " " : ""}${entry.data.word} for ${formatElapsed(entry.data.elapsedMs)}${this.#settings.features.doneMarkerTokens && entry.data.tokens !== undefined ? ` (↓ ${formatTokens(entry.data.tokens)} tokens)` : ""}`)}`,
				)
				: undefined,
		);
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

	private applyIndicator(ctx: ExtensionContext): void {
		const decorations = this.#settings.decorations;
		if (!decorations.animatedSpinner) {
			ctx.ui.setWorkingIndicator({ frames: [] });
			return;
		}

		const color = decorations.spinnerColorEnabled ? decorations.spinnerColor : "accent";
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
		const interval = decorations.shimmer
			? SHIMMER_INTERVAL
			: (decorations.tokenActivityMonitor || features.outputTokens)
				? METER_INTERVAL_MS
				: features.elapsedTime
					? ELAPSED_INTERVAL_MS
					: undefined;
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
		state.lastActivityMeterUpdate = 0;
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
		if (decorations.tokenActivityMonitor && now - state.lastActivityMeterUpdate >= METER_INTERVAL_MS) {
			state.activityMeter.push(rateToLevel(state.rateTracker.sample(total, now)));
			state.lastActivityMeterUpdate = now;
		}
		if (isFullyDefaultAppearance(features, decorations)) {
			ctx.ui.setWorkingMessage();
			return;
		}

		const word = features.substituteDefaultMessage ? state.currentWord : DEFAULT_WORKING_WORD;
		const styled = decorations.shimmer
			? shimmerString(word, now - state.shimmerOrigin, ctx.ui.theme, decorations.shimmerDirection)
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
		ctx.ui.setWorkingMessage(
			buildWorkingMessage(
				ctx.ui.theme,
				styled,
				meter,
				formatElapsed(now - state.startTime),
				formatTokens(total),
				features,
			),
		);
	}

	private async showSettings(ctx: ExtensionCommandContext): Promise<void> {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/topping-settings requires TUI mode", "error");
			return;
		}

		const before = `${this.#settings.decorations.animatedSpinner}:${this.#settings.decorations.spinnerColor}:${this.#settings.decorations.spinnerColorEnabled}`;
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
		if (
			before !==
			`${this.#settings.decorations.animatedSpinner}:${this.#settings.decorations.spinnerColor}:${this.#settings.decorations.spinnerColorEnabled}`
		) {
			this.applyIndicator(ctx);
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
