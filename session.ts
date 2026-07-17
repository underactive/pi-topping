import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { ActivityMeter, rateToLevel, TokRateTracker } from "./activity-meter.ts";
import { buildWorkingMessage, formatElapsed, formatTokens, isFullyDefaultAppearance, shimmerString, StreamingWordCounter } from "./format.ts";
import { showMenu } from "./menu.ts";
import { applyMenuResult, buildMenuSections, loadSettings, saveSettings } from "./settings.ts";
import { PreviewRenderer } from "./preview.ts";
import { pickRandomWord, pickRawWord } from "./words.ts";

const DONE_ENTRY_TYPE = "pi-topping-done";
const DEFAULT_WORKING_WORD = "Working…";
const SHIMMER_INTERVAL = 50;
const METER_INTERVAL_MS = 100;
export interface DoneEntryData { word: string; elapsedMs: number; }
export interface SessionState { startTime: number; currentWord: string; confirmTokens: number; liveTokens: number; shimmerOrigin: number; activityMeter: ActivityMeter; rateTracker: TokRateTracker; lastActivityMeterUpdate: number; timer: ReturnType<typeof setInterval> | null; busy: boolean; }
export function makeFreshState(): SessionState { return { startTime: 0, currentWord: "", confirmTokens: 0, liveTokens: 0, shimmerOrigin: 0, activityMeter: new ActivityMeter(), rateTracker: new TokRateTracker(), lastActivityMeterUpdate: 0, timer: null, busy: false }; }

/** Owns mutable extension state and Pi lifecycle registrations. */
export class SessionManager {
	#counter = new StreamingWordCounter(); #state = makeFreshState(); #settings = loadSettings(); #currentCtx: ExtensionContext | null = null;
	readonly #pi: ExtensionAPI;
	constructor(pi: ExtensionAPI) { this.#pi = pi; }
	install(): void {
		this.#pi.on("session_start", async (_e, ctx) => { this.stopTimer(); this.#counter.reset(); this.#currentCtx = null; this.#state = makeFreshState(); this.#settings = loadSettings(); this.#state.activityMeter.setDirection(this.#settings.decorations.meterDirection); this.#currentCtx = ctx; if (this.usable(ctx)) this.applyIndicator(ctx); });
		this.#pi.on("input", async (_e, ctx) => { this.#currentCtx = ctx; if (this.usable(ctx)) this.resetTurn(Date.now()); });
		this.#pi.on("agent_start", async (_e, ctx) => { this.#currentCtx = ctx; if (!this.usable(ctx)) return; if (!this.#state.startTime) this.resetTurn(Date.now()); this.#state.busy = true; this.startTimer(); this.tick(); });
		this.#pi.on("message_start", async (e, ctx) => { this.#currentCtx = ctx; if (this.usable(ctx) && e.message.role === "assistant") { this.#state.liveTokens = 0; this.#counter.reset(); } });
		this.#pi.on("message_update", async (e, ctx) => { this.#currentCtx = ctx; const a = e.assistantMessageEvent; if (this.usable(ctx) && a && (a.type === "text_delta" || a.type === "thinking_delta")) this.#state.liveTokens += this.#counter.count(a.delta, a.type); });
		this.#pi.on("message_end", async (e, ctx) => { this.#currentCtx = ctx; if (!this.usable(ctx) || e.message.role !== "assistant") return; this.#state.confirmTokens += e.message.usage?.output ?? this.#state.liveTokens; this.#state.liveTokens = 0; this.#counter.reset(); });
		this.#pi.on("tool_execution_start", async (_e, ctx) => { this.#currentCtx = ctx; if (this.usable(ctx)) { this.#state.currentWord = pickRandomWord(); this.#state.shimmerOrigin = Date.now(); } });
		this.#pi.on("agent_settled", async (_e, ctx) => { this.#currentCtx = ctx; if (!this.usable(ctx)) return; const hadPrompt = !!this.#state.startTime; const elapsedMs = hadPrompt ? Date.now() - this.#state.startTime : 0; this.#state.busy = false; this.#state.startTime = 0; this.#counter.reset(); this.stopTimer(); ctx.ui.setWorkingMessage(); this.applyIndicator(ctx); this.#state.activityMeter.reset(); this.#state.rateTracker.reset(); this.#state.lastActivityMeterUpdate = 0; if (this.#settings.features.doneMarker && hadPrompt) this.#pi.appendEntry<DoneEntryData>(DONE_ENTRY_TYPE, { word: pickRawWord().past_tense, elapsedMs }); this.#currentCtx = null; });
		this.#pi.on("session_shutdown", async () => this.stopTimer());
		this.#pi.registerEntryRenderer<DoneEntryData>(DONE_ENTRY_TYPE, (entry, _o, theme) => entry.data ? new Text(`${theme.fg("text", "π")}${theme.fg("dim", ` ${entry.data.word} for ${formatElapsed(entry.data.elapsedMs)}`)}`) : undefined);
		this.#pi.registerCommand("topping-settings", { description: "Configure pi-topping's spinner, shimmer, activity meter, and message details.", handler: async (_a, ctx) => this.showSettings(ctx) });
	}
	private usable(ctx: ExtensionContext): boolean { return !!ctx.hasUI && ctx.mode !== "print"; }
	private applyIndicator(ctx: ExtensionContext): void { ctx.ui.setWorkingIndicator(this.#settings.decorations.animatedSpinner ? undefined : { frames: [] }); }
	private stopTimer(): void { if (this.#state.timer) { clearInterval(this.#state.timer); this.#state.timer = null; } }
	private startTimer(): void { if (!this.#state.timer) this.#state.timer = setInterval(() => this.tick(), SHIMMER_INTERVAL); }
	private resetTurn(now: number): void { const s = this.#state; s.startTime = now; s.shimmerOrigin = now; s.currentWord = pickRandomWord(); s.confirmTokens = 0; s.liveTokens = 0; s.activityMeter.reset(); s.rateTracker.reset(); s.lastActivityMeterUpdate = 0; this.#counter.reset(); }
	private tick(): void { const ctx = this.#currentCtx, s = this.#state; if (!s.busy || !ctx) return; const now = Date.now(), total = s.confirmTokens + s.liveTokens; if (now - s.lastActivityMeterUpdate >= METER_INTERVAL_MS) { s.activityMeter.push(rateToLevel(s.rateTracker.sample(total, now))); s.lastActivityMeterUpdate = now; } const f = this.#settings.features, d = this.#settings.decorations; if (isFullyDefaultAppearance(f, d)) return ctx.ui.setWorkingMessage(); const word = f.substituteDefaultMessage ? s.currentWord : DEFAULT_WORKING_WORD; const styled = d.shimmer ? shimmerString(word, now - s.shimmerOrigin, ctx.ui.theme) : ctx.ui.theme.fg("text", word); const meter = d.tokenActivityMonitor ? s.activityMeter.render((l, c) => ActivityMeter.colorizeCell(l, c, ctx.ui.theme)) : ""; ctx.ui.setWorkingMessage(buildWorkingMessage(ctx.ui.theme, styled, meter, formatElapsed(now - s.startTime), formatTokens(total), f)); }
	private async showSettings(ctx: ExtensionCommandContext): Promise<void> { if (ctx.mode !== "tui") { ctx.ui.notify("/topping-settings requires TUI mode", "error"); return; } const before = this.#settings.decorations.animatedSpinner; const preview = new PreviewRenderer(ctx); const result = await showMenu<Record<string, boolean>>(ctx, { title: "Pi Topping: Settings", sections: buildMenuSections(this.#settings), hints: ["↑↓ move", "␣ toggle", "⏎ apply", "esc cancel"], preview: preview.render.bind(preview) }); if (!result.applied) return; this.#settings = applyMenuResult(this.#settings, result.values); saveSettings(this.#settings); if (before !== this.#settings.decorations.animatedSpinner) this.applyIndicator(ctx); this.#state.activityMeter.setDirection(this.#settings.decorations.meterDirection); ctx.ui.notify("Pi Topping settings saved", "info"); }
}
