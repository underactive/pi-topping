/**
 * pi-topping
 *
 * Replaces pi's default "Working..." loader text with a shimmering,
 * randomized activity word plus live elapsed-since-prompt time and a live
 * output-token estimate, e.g.:
 *
 *   Cerebrating… (4m 46s · ↓ 17k tokens)
 *
 * - A new random word is picked on every user prompt and on every tool
 *   execution start (so long tool loops keep feeling "alive").
 * - Elapsed time counts up continuously from the moment the prompt is
 *   submitted, uninterrupted by tool calls.
 * - Token count is a live streaming-delta word-count estimate that gets
 *   reconciled against the authoritative usage total at each assistant
 *   message_end.
 *
 * All of the above are independently toggleable via `/topping-settings`
 * (see settings.ts and menu.ts); every toggle defaults to enabled.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatElapsed, formatTokens, StreamingWordCounter } from "./format.ts";
import { ActivityMeter, rateToLevel, TokRateTracker } from "./activity-meter.ts";
import { showMenu, type MenuSection } from "./menu.ts";
import { type DecoratorSettings, loadSettings, saveSettings } from "./settings.ts";
import { WORDS } from "./words.ts";

/** Custom-entry type name for the durable completion marker appended at `agent_settled`. */
const DONE_ENTRY_TYPE = "pi-topping-done";

/** Payload persisted on the durable completion marker entry. */
interface DoneEntryData {
	word: string;
	elapsedMs: number;
}

function pickRawWord(): string {
	return WORDS[Math.floor(Math.random() * WORDS.length)]!;
}

function pickRandomWord(): string {
	return `${pickRawWord()}\u2026`;
}

// ---------------------------------------------------------------------------
// Grayscale shimmer (ported from pi-synthwave-statusline's shimmerString)
// ---------------------------------------------------------------------------

const SHIMMER_INTERVAL = 50; // ms (20fps; activity meter updates every 100ms)
const ACTIVITY_METER_INTERVAL_MS = 100;
const SHIMMER_SWEEP_S = 2.0; // seconds per full L->R sweep
const SHIMMER_BAND_HALF = 5.0; // half-width of highlight band in chars
const SHIMMER_PADDING = 10; // extra sweep padding so band enters/exits smoothly

// Placeholder word shown in place of the randomized activity word when
// "Substitute Pi's Working... message" is off. Decorations (shimmer, meter)
// and features (elapsed time, output tokens) still apply to this placeholder
// independently -- that toggle only controls which *word* is shown, not
// whether the other toggles have any effect.
const DEFAULT_WORKING_WORD = "Working\u2026";

// Settings-menu live preview: a self-contained simulation (fake word, fake
// spinner, fake breathing activity-meter rate) driving the same rendering
// code paths as the real working message, so the preview always matches
// reality exactly.
const PREVIEW_SPINNER_FRAMES = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"];
const PREVIEW_SPINNER_INTERVAL_MS = 80;
const PREVIEW_TOKEN_RATE_PER_SEC = 28;
// The meter's simulated rate oscillates smoothly between idle and full
// (rather than holding a constant value) so it's visibly animated instead of
// scrolling in a flat, unchanging line. One full idle->full->idle breath
// takes PREVIEW_METER_PERIOD_MS; PREVIEW_METER_PEAK_RATE sits comfortably
// above rateToLevel's top threshold (40 tok/s) so the meter reaches FULL.
const PREVIEW_METER_PERIOD_MS = 2400;
const PREVIEW_METER_PEAK_RATE = 46;

/** Smoothly oscillating tok/s value used to animate the settings-menu preview meter. */
function previewMeterRate(elapsedMs: number): number {
	const wave = (1 - Math.cos((2 * Math.PI * elapsedMs) / PREVIEW_METER_PERIOD_MS)) / 2; // 0..1, eased
	return wave * PREVIEW_METER_PEAK_RATE;
}

/**
 * True only when every toggle that could customize the working message is
 * off, i.e. the message would look exactly like Pi's untouched default. In
 * that case (and only that case) we fully restore the default instead of
 * building a message that merely happens to look the same.
 */
function isFullyDefaultAppearance(
	substituteDefaultMessage: boolean,
	shimmer: boolean,
	tokenActivityMonitor: boolean,
	elapsedTime: boolean,
	outputTokens: boolean,
): boolean {
	return !substituteDefaultMessage && !shimmer && !tokenActivityMonitor && !elapsedTime && !outputTokens;
}

/** Codex-style light-sweep shimmer using the active Pi theme. */
function shimmerString(text: string, elapsedMs: number, theme: ExtensionContext["ui"]["theme"]): string {
	const chars = [...text];
	if (chars.length === 0) return "";
	const period = chars.length + SHIMMER_PADDING * 2;
	const elapsedS = elapsedMs / 1000;
	const pos = ((elapsedS % SHIMMER_SWEEP_S) / SHIMMER_SWEEP_S) * period;

	return (
		chars
			.map((ch, i) => {
				const dist = Math.abs(i + SHIMMER_PADDING - pos);
				const intensity =
					dist <= SHIMMER_BAND_HALF
						? 0.5 * (1 + Math.cos((Math.PI * dist) / SHIMMER_BAND_HALF))
						: 0;
				if (intensity > 0.6) return theme.bold(theme.fg("text", ch));
				if (intensity > 0.15) return theme.fg("muted", ch);
				return theme.fg("dim", ch);
			})
			.join("")
	);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

interface SessionState {
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

function makeFreshState(): SessionState {
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

function cloneSettings(settings: DecoratorSettings): DecoratorSettings {
	return {
		decorations: { ...settings.decorations },
		features: { ...settings.features },
	};
}

/**
 * Applies a flat `{ id: boolean }` menu result onto a nested settings
 * section in place, using each section's own key names as the source of
 * truth. A key only gets updated if `values` actually contains it (so a
 * partial/incomplete `values` object never zeroes out unrelated keys) --
 * this preserves the exact semantics of the previous manual `??` chain.
 *
 * This only works because every settings leaf is a `boolean` and every
 * `MenuItem.id` is spelled identically to its corresponding settings key.
 * If a future toggle needs a non-boolean value, `menu.ts`'s
 * `MenuItem.value: boolean` would need to change first.
 */
function applyMenuValues<T extends Record<string, boolean>>(target: T, values: Record<string, boolean>): void {
	for (const key of Object.keys(target) as (keyof T & string)[]) {
		const incoming = values[key];
		if (incoming !== undefined) {
			target[key] = incoming as T[keyof T & string];
		}
	}
}

/**
 * Pi extension install hook.
 *
 * Registers event handlers on the Pi lifecycle to replace the default
 * "Working..." indicator with a shimmering activity word, live elapsed
 * time, and an output-token rate activity meter -- gated by persisted
 * settings configurable via `/topping-settings`.
 *
 * Events subscribed: session_start, input, agent_start, message_start,
 * message_update, message_end, tool_execution_start, agent_settled,
 * session_shutdown.
 *
 * Callback signatures follow the Pi ExtensionAPI.on() contract:
 * - Pi event payload as first argument (or _event if unused)
 * - ExtensionContext as second argument providing { hasUI, mode, ui }
 */
export default function (pi: ExtensionAPI) {
	const liveWordCounter = new StreamingWordCounter();
	let state = makeFreshState();
	let settings = loadSettings();
	// Tracks the most recent ctx handed to us so the interval below never acts
	// on a stale closure captured when the timer was first created.
	let currentCtx: ExtensionContext | null = null;

	function applyIndicator(ctx: ExtensionContext) {
		ctx.ui.setWorkingIndicator(settings.decorations.animatedSpinner ? undefined : { frames: [] });
	}

	function stopTimer() {
		if (state.timer) {
			clearInterval(state.timer);
			state.timer = null;
		}
	}

	function resetTurn(now: number) {
		state.startTime = now;
		state.shimmerOrigin = now;
		state.currentWord = pickRandomWord();
		state.confirmTokens = 0;
		state.liveTokens = 0;
		state.activityMeter.reset();
		state.rateTracker.reset();
		state.lastActivityMeterUpdate = 0;
		liveWordCounter.reset();
	}

	function tick() {
		const ctx = currentCtx;
		if (!state.busy || !ctx) return;
		const now = Date.now();
		const elapsedStr = formatElapsed(now - state.startTime);
		const total = state.confirmTokens + state.liveTokens;
		const tokenStr = formatTokens(total);
		updateMeter(now, total);

		const { substituteDefaultMessage, elapsedTime, outputTokens } = settings.features;
		const { shimmer, tokenActivityMonitor } = settings.decorations;

		if (isFullyDefaultAppearance(substituteDefaultMessage, shimmer, tokenActivityMonitor, elapsedTime, outputTokens)) {
			ctx.ui.setWorkingMessage();
			return;
		}

		const word = substituteDefaultMessage ? state.currentWord : DEFAULT_WORKING_WORD;
		const shimmered = shimmer
			? shimmerString(word, now - state.shimmerOrigin, ctx.ui.theme)
			: ctx.ui.theme.fg("text", word);
		const frame = tokenActivityMonitor ? renderFrame(ctx) : "";
		const msg = buildMessage(ctx, shimmered, frame, elapsedStr, tokenStr, settings.features);
		ctx.ui.setWorkingMessage(msg);
	}

	function updateMeter(now: number, total: number): void {
		if (now - state.lastActivityMeterUpdate >= ACTIVITY_METER_INTERVAL_MS) {
			const rate = state.rateTracker.sample(total, now);
			state.activityMeter.push(rateToLevel(rate));
			state.lastActivityMeterUpdate = now;
		}
	}

	function renderFrame(ctx: ExtensionContext): string {
		return state.activityMeter.render((level, char) => ActivityMeter.colorizeCell(level, char, ctx.ui.theme));
	}

	function buildMessage(
		ctx: ExtensionContext,
		shimmered: string,
		frame: string,
		elapsedStr: string,
		tokenStr: string,
		features: { elapsedTime: boolean; outputTokens: boolean },
	): string {
		const parts: string[] = [shimmered];
		if (frame) parts.push(frame);

		const details: string[] = [];
		if (features.elapsedTime) details.push(elapsedStr);
		if (features.outputTokens) details.push(`\u2193 ${tokenStr} tokens`);
		if (details.length > 0) {
			parts.push(ctx.ui.theme.fg("dim", `(${details.join(" \u00b7 ")})`));
		}

		return parts.filter((part) => part.length > 0).join(" ");
	}

	/**
	 * Builds a self-contained preview renderer for the settings menu: a fake
	 * spinner, a fake word with continuous shimmer, a fake breathing (idle to
	 * full and back) activity meter, and a real live-incrementing elapsed timer, all gated by
	 * the same toggles as the real working message so the preview is an exact
	 * simulation. State (word, meter, rate tracker) is scoped per menu open so
	 * each invocation of `/topping-settings` starts the animation
	 * fresh.
	 */
	function makePreviewRenderer(ctx: ExtensionContext): (values: Record<string, boolean>, elapsedMs: number) => string[] {
		const word = pickRandomWord();
		const meter = new ActivityMeter();
		let lastMeterUpdate = 0;

		return (values, elapsedMs) => {
			const simulatedTokens = Math.max(0, Math.floor((elapsedMs / 1000) * PREVIEW_TOKEN_RATE_PER_SEC));
			if (elapsedMs - lastMeterUpdate >= ACTIVITY_METER_INTERVAL_MS) {
				meter.push(rateToLevel(previewMeterRate(elapsedMs)));
				lastMeterUpdate = elapsedMs;
			}

			const spinnerFrame =
				PREVIEW_SPINNER_FRAMES[Math.floor(elapsedMs / PREVIEW_SPINNER_INTERVAL_MS) % PREVIEW_SPINNER_FRAMES.length]!;
			const spinnerGlyph = values.animatedSpinner ? ctx.ui.theme.fg("accent", spinnerFrame) : "";

			const substituteDefaultMessage = values.substituteDefaultMessage ?? true;
			const shimmer = values.shimmer ?? true;
			const tokenActivityMonitor = values.tokenActivityMonitor ?? true;
			const elapsedTime = values.elapsedTime ?? true;
			const outputTokens = values.outputTokens ?? true;

			if (isFullyDefaultAppearance(substituteDefaultMessage, shimmer, tokenActivityMonitor, elapsedTime, outputTokens)) {
				return [[spinnerGlyph, ctx.ui.theme.fg("dim", DEFAULT_WORKING_WORD)].filter((part) => part.length > 0).join(" ")];
			}

			const displayWord = substituteDefaultMessage ? word : DEFAULT_WORKING_WORD;
			const elapsedStr = formatElapsed(elapsedMs);
			const tokenStr = formatTokens(simulatedTokens);
			const shimmered = shimmer
				? shimmerString(displayWord, elapsedMs, ctx.ui.theme)
				: ctx.ui.theme.fg("text", displayWord);
			const frame = tokenActivityMonitor
				? meter.render((level, char) => ActivityMeter.colorizeCell(level, char, ctx.ui.theme))
				: "";
			const message = buildMessage(ctx, shimmered, frame, elapsedStr, tokenStr, { elapsedTime, outputTokens });

			return [[spinnerGlyph, message].filter((part) => part.length > 0).join(" ")];
		};
	}

	function startTimer() {
		if (state.timer) return;
		state.timer = setInterval(tick, SHIMMER_INTERVAL);
	}

	const useUI = (ctx: ExtensionContext): boolean => {
		if (!ctx.hasUI || ctx.mode === "print") return false;
		currentCtx = ctx;
		return true;
	};

	pi.on("session_start", async (_event, ctx) => {
		stopTimer();
		liveWordCounter.reset();
		currentCtx = null;
		state = makeFreshState();
		settings = loadSettings();
		if (useUI(ctx)) applyIndicator(ctx);
	});

	pi.on("input", async (_event, ctx) => {
		if (!useUI(ctx)) return;
		resetTurn(Date.now());
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (!useUI(ctx)) return;
		if (state.startTime === 0) resetTurn(Date.now());
		state.busy = true;
		startTimer();
		tick();
	});

	pi.on("message_start", async (event, ctx) => {
		if (!useUI(ctx)) return;
		if (event.message.role === "assistant") {
			state.liveTokens = 0;
			liveWordCounter.reset();
		}
	});

	pi.on("message_update", async (event, ctx) => {
		if (!useUI(ctx)) return;
		const ame = event.assistantMessageEvent;
		if (ame && (ame.type === "text_delta" || ame.type === "thinking_delta")) {
			state.liveTokens += liveWordCounter.count(ame.delta, ame.type);
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (!useUI(ctx)) return;
		if (event.message.role !== "assistant") return;
		state.confirmTokens += event.message.usage?.output ?? state.liveTokens;
		state.liveTokens = 0;
		liveWordCounter.reset();
	});

	pi.on("tool_execution_start", async (_event, ctx) => {
		if (!useUI(ctx)) return;
		state.currentWord = pickRandomWord();
		state.shimmerOrigin = Date.now();
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!useUI(ctx)) return;
		const hadPrompt = state.startTime !== 0;
		const elapsedMs = hadPrompt ? Date.now() - state.startTime : 0;
		state.busy = false;
		state.startTime = 0;
		liveWordCounter.reset();
		stopTimer();
		ctx.ui.setWorkingMessage();
		applyIndicator(ctx);
		state.activityMeter.reset();
		state.rateTracker.reset();
		state.lastActivityMeterUpdate = 0;
		if (settings.features.doneMarker && hadPrompt) {
			pi.appendEntry<DoneEntryData>(DONE_ENTRY_TYPE, { word: pickRawWord(), elapsedMs });
		}
		currentCtx = null;
	});

	pi.on("session_shutdown", async (_event, _ctx) => {
		stopTimer();
	});

	pi.registerEntryRenderer<DoneEntryData>(DONE_ENTRY_TYPE, (entry, _options, theme) => {
		const data = entry.data;
		if (!data) return undefined;
		const elapsedStr = formatElapsed(data.elapsedMs);
		const text = `${theme.fg("text", "\u03c0")}${theme.fg("dim", ` ${data.word} for ${elapsedStr}`)}`;
		return new Text(text);
	});

	pi.registerCommand("topping-settings", {
		description: "Configure pi-topping's spinner, shimmer, activity meter, and message details.",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/topping-settings requires TUI mode", "error");
				return;
			}

			const before = settings.decorations.animatedSpinner;
			const sections: MenuSection[] = [
				{
					title: "Decorations",
					items: [
						{ id: "animatedSpinner", label: "Animated spinner", value: settings.decorations.animatedSpinner },
						{ id: "shimmer", label: "\u201cWorking...\u201d text shimmer", value: settings.decorations.shimmer },
						{
							id: "tokenActivityMonitor",
							label: "Token activity monitor",
							value: settings.decorations.tokenActivityMonitor,
						},
					],
				},
				{
					title: "Features",
					items: [
						{
							id: "substituteDefaultMessage",
							label: "Substitute Pi's \u201cWorking...\u201d message",
							value: settings.features.substituteDefaultMessage,
						},
						{ id: "elapsedTime", label: "Elapsed time since prompt", value: settings.features.elapsedTime },
						{ id: "outputTokens", label: "Show output tokens", value: settings.features.outputTokens },
						{ id: "doneMarker", label: "Show completion marker", value: settings.features.doneMarker },
					],
				},
			];

			const result = await showMenu<Record<string, boolean>>(ctx, {
				title: "Pi Topping: Settings",
				sections,
				hints: ["\u2191\u2193 move", "\u2423 toggle", "\u23ce apply", "esc cancel"],
				preview: makePreviewRenderer(ctx),
			});

			if (!result.applied) return;

			const next = cloneSettings(settings);
			applyMenuValues(next.decorations, result.values);
			applyMenuValues(next.features, result.values);

			settings = next;
			saveSettings(settings);
			if (settings.decorations.animatedSpinner !== before) applyIndicator(ctx);
			ctx.ui.notify("Pi Topping settings saved", "info");
		},
	});
}
