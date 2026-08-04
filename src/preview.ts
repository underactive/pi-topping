import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PreviewResult } from "./menu.ts";
import { ActivityMeter, rateToLevel } from "./activity-meter.ts";
import { buildWorkingMessage, DEFAULT_WORKING_WORD, formatElapsed, formatTokenRate, formatTokens, isFullyDefaultAppearance, METER_INTERVAL_MS, shimmerString, SPINNER_FRAME_MS, SPINNER_FRAMES } from "./format.ts";
import { buildPromptBoxLines } from "./prompt-decorator.ts";
import { fromCycleValue, isSettingColor, LOADER_ORDER_ID, parseLoaderOrder } from "./settings.ts";
import { pickRandomWord } from "./words.ts";
// Simulated load for the menu preview: a 2.4s cosine wave peaking at 46 tok/s for the meter,
// flat 28 tok/s for the token readouts.
const METER_PERIOD_MS = 2400, METER_PEAK_RATE = 46, TOKEN_RATE_PER_SEC = 28;
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
		return { lines: ["", this.loaderPreview(values, elapsedMs), ""], nextRefreshInMs: SPINNER_FRAME_MS };
	}
	private loaderPreview(values: Record<string, boolean | string>, elapsedMs: number): string {
		this.#meter.setDirection(fromCycleValue(values.meterDirection as string) as "ltr" | "rtl");
		if (elapsedMs - this.#lastMeterUpdate >= METER_INTERVAL_MS) { this.#meter.push(rateToLevel(meterRate(elapsedMs))); this.#lastMeterUpdate = elapsedMs; }
		const features = { substituteDefaultMessage: values.substituteDefaultMessage !== false, elapsedTime: values.elapsedTime !== false, outputTokens: values.outputTokens !== false, tokenRate: values.showTokenRate !== false };
		const decorations = { shimmer: values.shimmer !== false, tokenActivityMonitor: values.tokenActivityMonitor !== false };
		const spinnerColor = values.spinnerColorEnabled === false || !isSettingColor(values.spinnerColor) ? "accent" : values.spinnerColor;
		const spinner = values.animatedSpinner ? this.#ctx.ui.theme.fg(spinnerColor, SPINNER_FRAMES[Math.floor(elapsedMs / SPINNER_FRAME_MS) % SPINNER_FRAMES.length]!) : "";
		const order = parseLoaderOrder(values[LOADER_ORDER_ID]);
		if (isFullyDefaultAppearance(features, decorations)) return buildWorkingMessage(this.#ctx.ui.theme, { spinner, text: this.#ctx.ui.theme.fg("dim", DEFAULT_WORKING_WORD) }, order);
		const word = features.substituteDefaultMessage ? this.#word : DEFAULT_WORKING_WORD;
		const styledWord = decorations.shimmer ? shimmerString(word, elapsedMs, this.#ctx.ui.theme, fromCycleValue(values.shimmerDirection as string) as "ltr" | "rtl", fromCycleValue(values.shimmerSpeed as string) as "slow" | "normal" | "fast") : this.#ctx.ui.theme.fg("text", word);
		const meterColor = values.meterColorEnabled === false || !isSettingColor(values.meterColor) ? "accent" : values.meterColor;
		const meter = decorations.tokenActivityMonitor ? this.#meter.render((level, char) => ActivityMeter.colorizeCell(level, char, this.#ctx.ui.theme, meterColor, values.meterDimmed !== false)) : "";
		const tokenRateText = features.tokenRate ? formatTokenRate(TOKEN_RATE_PER_SEC) : "";
		const tokenRateColor = isSettingColor(values.tokenRateColor) ? values.tokenRateColor : "warning";
		const tokenRateColored = tokenRateText ? this.#ctx.ui.theme.fg(tokenRateColor, tokenRateText) : "";
		const tokenRate = tokenRateColored && values.tokenRateDimmed === true ? `\x1b[2m${tokenRateColored}\x1b[22m` : tokenRateColored;
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
			borderColor: isSettingColor(borderColor) ? borderColor : "accent",
			borderStyle: borderStyle === "double" || borderStyle === "single" || borderStyle === "rounded" || borderStyle === "heavy" ? borderStyle : "double",
		});
		return timestamp === undefined
			? { lines }
			: { lines, nextRefreshInMs: 1_000 - (timestamp % 1_000) };
	}
	private markerPreview(values: Record<string, boolean | string>): PreviewResult {
		if (!values.doneMarker) return { lines: ["Completion marker is disabled."] };
		const theme = this.#ctx.ui.theme;
		const icon = values.doneMarkerIcon ? `${values.useNerdFont ? "" : "π"} ` : "";
		const word = values.randomizeDoneMarker ? "Concocted" : "Worked";
		const details: string[] = [];
		if (values.doneMarkerTokens) details.push("↓ 949 tokens");
		if (values.doneMarkerInputs) details.push("2 mid-turn inputs");
		const tail = details.length ? ` (${details.join(" · ")})` : "";
		return { lines: ["", `${values.doneMarkerIcon ? theme.fg("text", icon) : ""}${theme.fg("dim", `${word} for 2m 52s${tail}`)}`, ""] };
	}
}
