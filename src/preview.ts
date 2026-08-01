import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PreviewResult } from "./menu.ts";
import { ActivityMeter, rateToLevel } from "./activity-meter.ts";
import { buildWorkingMessage, formatElapsed, formatTokenRate, formatTokens, isFullyDefaultAppearance, shimmerString, SPINNER_FRAME_MS, SPINNER_FRAMES } from "./format.ts";
import { buildPromptBoxLines } from "./prompt-decorator.ts";
import { LOADER_ORDER_ID, parseLoaderOrder } from "./settings.ts";
import { pickRandomWord } from "./words.ts";
const METER_INTERVAL_MS = 100, METER_PERIOD_MS = 2400, METER_PEAK_RATE = 46, TOKEN_RATE_PER_SEC = 28;
const DEFAULT_WORKING_WORD = "Working…";
const PROMPT_IDS = new Set(["decorateUserPrompt", "borderColor", "borderStyle", "promptIcon", "promptTimestamp"]);
const MARKER_IDS = new Set(["doneMarker", "doneMarkerIcon", "randomizeDoneMarker", "doneMarkerTokens", "doneMarkerInputs"]);
function meterRate(elapsedMs: number): number { return ((1 - Math.cos((2 * Math.PI * elapsedMs) / METER_PERIOD_MS)) / 2) * METER_PEAK_RATE; }

/** Stateful, per-menu preview renderer that follows the active settings section. */
export class PreviewRenderer {
	readonly #word = pickRandomWord(); readonly #meter = new ActivityMeter(); #lastMeterUpdate = 0;
	readonly #ctx: ExtensionContext;
	constructor(ctx: ExtensionContext) { this.#ctx = ctx; }
	render(values: Record<string, boolean | string>, elapsedMs: number, activeItemId?: string): PreviewResult {
		if (PROMPT_IDS.has(activeItemId ?? "")) return this.promptPreview(values);
		if (MARKER_IDS.has(activeItemId ?? "")) return this.markerPreview(values);
		if (activeItemId === "useNerdFont") return { lines: [`Icon preview: ${values.useNerdFont ? "" : "π"}`] };
		return { lines: ["", this.loaderPreview(values, elapsedMs), ""], nextRefreshInMs: 80 };
	}
	private loaderPreview(values: Record<string, boolean | string>, elapsedMs: number): string {
		this.#meter.setDirection(values.meterDirection === "Right to Left" ? "rtl" : "ltr");
		if (elapsedMs - this.#lastMeterUpdate >= METER_INTERVAL_MS) { this.#meter.push(rateToLevel(meterRate(elapsedMs))); this.#lastMeterUpdate = elapsedMs; }
		const features = { substituteDefaultMessage: values.substituteDefaultMessage !== false, elapsedTime: values.elapsedTime !== false, outputTokens: values.outputTokens !== false, tokenRate: values.showTokenRate !== false };
		const decorations = { shimmer: values.shimmer !== false, tokenActivityMonitor: values.tokenActivityMonitor !== false };
		const spinnerColor = (values.spinnerColorEnabled === false ? "accent" : values.spinnerColor === "border" || values.spinnerColor === "borderAccent" ? values.spinnerColor : "accent") as "accent" | "border" | "borderAccent";
		const spinner = values.animatedSpinner ? this.#ctx.ui.theme.fg(spinnerColor, SPINNER_FRAMES[Math.floor(elapsedMs / SPINNER_FRAME_MS) % SPINNER_FRAMES.length]!) : "";
		const order = parseLoaderOrder(values[LOADER_ORDER_ID]);
		if (isFullyDefaultAppearance(features, decorations)) return buildWorkingMessage(this.#ctx.ui.theme, { spinner, text: this.#ctx.ui.theme.fg("dim", DEFAULT_WORKING_WORD) }, order);
		const word = features.substituteDefaultMessage ? this.#word : DEFAULT_WORKING_WORD;
		const styledWord = decorations.shimmer ? shimmerString(word, elapsedMs, this.#ctx.ui.theme, values.shimmerDirection === "Right to Left" ? "rtl" : "ltr", values.shimmerSpeed === "Slow" ? "slow" : values.shimmerSpeed === "Fast" ? "fast" : "normal") : this.#ctx.ui.theme.fg("text", word);
		const meterColor = (values.meterColorEnabled === false ? "accent" : values.meterColor === "border" || values.meterColor === "borderAccent" ? values.meterColor : "accent") as "accent" | "border" | "borderAccent";
		const meter = decorations.tokenActivityMonitor ? this.#meter.render((level, char) => ActivityMeter.colorizeCell(level, char, this.#ctx.ui.theme, meterColor, values.meterDimmed !== false)) : "";
		const tokenRateText = features.tokenRate ? formatTokenRate(TOKEN_RATE_PER_SEC) : "";
		const tokenRateWarning = tokenRateText ? this.#ctx.ui.theme.fg("warning", tokenRateText) : "";
		const tokenRate = tokenRateWarning && values.tokenRateDimmed === true ? `\x1b[2m${tokenRateWarning}\x1b[22m` : tokenRateWarning;
		return buildWorkingMessage(this.#ctx.ui.theme, {
			spinner,
			text: styledWord,
			meter,
			elapsed: features.elapsedTime ? formatElapsed(elapsedMs) : "",
			tokens: features.outputTokens ? `↓ ${formatTokens(Math.max(0, Math.floor(elapsedMs / 1000 * TOKEN_RATE_PER_SEC)))} tokens` : "",
			tokenRate,
		}, order);
	}
	private promptPreview(values: Record<string, boolean | string>): PreviewResult {
		if (!values.decorateUserPrompt) return { lines: ["User prompt decoration is disabled."] };

		const borderColor = values.borderColor;
		const borderStyle = values.borderStyle;
		const timestamp = values.promptTimestamp ? Date.now() : undefined;
		const lines = buildPromptBoxLines("ping", timestamp, 70, this.#ctx.ui.theme, {
			showIcon: values.promptIcon as boolean,
			showTimestamp: values.promptTimestamp as boolean,
			icon: values.useNerdFont ? "" : "π",
			borderColor: borderColor === "accent" || borderColor === "border" || borderColor === "borderAccent" ? borderColor : "accent",
			borderStyle: borderStyle === "double" || borderStyle === "single" || borderStyle === "rounded" || borderStyle === "heavy" ? borderStyle : "double",
		});
		return timestamp === undefined
			? { lines }
			: { lines, nextRefreshInMs: 1_000 - (timestamp % 1_000) };
	}
	private markerPreview(values: Record<string, boolean | string>): PreviewResult {
		if (!values.doneMarker) return { lines: ["Completion marker is disabled."] };
		const th = this.#ctx.ui.theme;
		const icon = values.doneMarkerIcon ? `${values.useNerdFont ? "" : "π"} ` : "";
		const word = (values.randomizeDoneMarker ? "Concocted" : "Worked") as string;
		const details: string[] = [];
		if (values.doneMarkerTokens) details.push("↓ 949 tokens");
		if (values.doneMarkerInputs) details.push("2 mid-turn inputs");
		const tail = details.length ? ` (${details.join(" · ")})` : "";
		return { lines: ["", `${values.doneMarkerIcon ? th.fg("text", icon) : ""}${th.fg("dim", `${word} for 2m 52s${tail}`)}`, ""] };
	}
}
