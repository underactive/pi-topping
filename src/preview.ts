import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PreviewResult } from "./menu.ts";
import { ActivityMeter, rateToLevel } from "./activity-meter.ts";
import { buildWorkingMessage, DEFAULT_WORKING_WORD, dimAttribute, ELAPSED_INTERVAL_MS, formatElapsed, formatTokenRate, formatTokens, isFullyDefaultAppearance, METER_INTERVAL_MS, SHIMMER_INTERVAL_MS, shimmerString, SPINNER_FRAME_MS, SPINNER_FRAMES } from "./format.ts";
import { buildCompletionMarkerContent, buildCompletionMarkerLine, buildPromptBoxLines } from "./prompt-decorator.ts";
import { DEFAULT_SETTINGS, fromCycleDirection, fromCycleSpeed, isBorderStyle, isDoneMarkerBorderStyle, isSettingColor, LOADER_ORDER_ID, MENU_ENTRIES, parseLoaderOrder } from "./settings.ts";
import { pickCombinedWorkingText } from "./simcity.ts";
import { pickRandomWord } from "./words.ts";
// Simulated load for the menu preview: a 2.4s cosine wave peaking at 46 tok/s for the meter,
// flat 28 tok/s for the token readouts.
const METER_PERIOD_MS = 2400, METER_PEAK_RATE = 46, TOKEN_RATE_PER_SEC = 28, PREVIEW_WIDTH = 70;
const PROMPT_IDS = new Set(MENU_ENTRIES.filter(entry => entry.section === "User Prompt").map(entry => entry.id));
const MARKER_IDS = new Set(MENU_ENTRIES.filter(entry => entry.section === "Completion Marker").map(entry => entry.id));
function meterRate(elapsedMs: number): number { return ((1 - Math.cos((2 * Math.PI * elapsedMs) / METER_PERIOD_MS)) / 2) * METER_PEAK_RATE; }

/** Stateful, per-menu preview renderer that follows the active settings section. */
export class PreviewRenderer {
	// Keep this order: deterministic preview tests seed the built-in draw, then the combined-pool draw.
	readonly #word = pickRandomWord();
	readonly #combinedWord = pickCombinedWorkingText();
	readonly #meter = new ActivityMeter();
	#lastMeterUpdate = 0;
	readonly #ctx: ExtensionContext;
	constructor(ctx: ExtensionContext) { this.#ctx = ctx; }
	render(values: Record<string, boolean | string>, elapsedMs: number, activeItemId?: string): PreviewResult {
		if (PROMPT_IDS.has(activeItemId ?? "")) return this.promptPreview(values);
		if (MARKER_IDS.has(activeItemId ?? "")) return this.markerPreview(values);
		if (activeItemId === "useNerdFont") return { lines: [`Icon preview: ${values.useNerdFont ? "" : "π"}`] };
		let nextRefreshInMs: number | undefined;
		if (values.shimmer !== false) {
			nextRefreshInMs = SHIMMER_INTERVAL_MS;
		} else if (values.animatedSpinner !== false) {
			nextRefreshInMs = SPINNER_FRAME_MS;
		} else if (values.tokenActivityMonitor !== false) {
			nextRefreshInMs = METER_INTERVAL_MS;
		} else if (values.elapsedTime !== false || values.outputTokens !== false) {
			nextRefreshInMs = ELAPSED_INTERVAL_MS;
		}
		return { lines: ["", this.loaderPreview(values, elapsedMs), ""], nextRefreshInMs };
	}
	private loaderPreview(values: Record<string, boolean | string>, elapsedMs: number): string {
		this.#meter.setDirection(fromCycleDirection(values.meterDirection));
		if (elapsedMs - this.#lastMeterUpdate >= METER_INTERVAL_MS) {
			this.#meter.push(rateToLevel(meterRate(elapsedMs)));
			this.#lastMeterUpdate = elapsedMs;
		}
		const features = { substituteDefaultMessage: values.substituteDefaultMessage !== false, simCityWorkingText: values.simCityWorkingText === true, elapsedTime: values.elapsedTime !== false, outputTokens: values.outputTokens !== false, tokenRate: values.showTokenRate !== false };
		const decorations = { shimmer: values.shimmer !== false, shimmerInverted: values.shimmerInverted === true, tokenActivityMonitor: values.tokenActivityMonitor !== false };
		let spinnerColor = DEFAULT_SETTINGS.decorations.spinnerColor;
		if (values.spinnerColorEnabled !== false && isSettingColor(values.spinnerColor)) {
			spinnerColor = values.spinnerColor;
		}
		let spinner = "";
		if (values.animatedSpinner !== false) {
			spinner = this.#ctx.ui.theme.fg(spinnerColor, SPINNER_FRAMES[Math.floor(elapsedMs / SPINNER_FRAME_MS) % SPINNER_FRAMES.length]!);
		}
		const order = parseLoaderOrder(values[LOADER_ORDER_ID]);
		if (isFullyDefaultAppearance(features, decorations)) {
			return buildWorkingMessage(this.#ctx.ui.theme, { spinner, text: this.#ctx.ui.theme.fg("dim", DEFAULT_WORKING_WORD) }, order);
		}
		let word = DEFAULT_WORKING_WORD;
		if (features.substituteDefaultMessage) {
			word = features.simCityWorkingText ? this.#combinedWord : this.#word;
		}
		let styledWord: string;
		if (decorations.shimmer) {
			styledWord = shimmerString(word, elapsedMs, this.#ctx.ui.theme, fromCycleDirection(values.shimmerDirection), fromCycleSpeed(values.shimmerSpeed), decorations.shimmerInverted);
		} else {
			styledWord = this.#ctx.ui.theme.fg("text", word);
		}
		let meterColor = DEFAULT_SETTINGS.decorations.meterColor;
		if (values.meterColorEnabled !== false && isSettingColor(values.meterColor)) {
			meterColor = values.meterColor;
		}
		let meter = "";
		if (decorations.tokenActivityMonitor) {
			meter = this.#meter.render((level, char) => ActivityMeter.colorizeCell(level, char, this.#ctx.ui.theme, meterColor, values.meterDimmed === true));
		}
		let tokenRateText = "";
		if (features.tokenRate) {
			tokenRateText = formatTokenRate(TOKEN_RATE_PER_SEC);
		}
		let tokenRateColor = DEFAULT_SETTINGS.decorations.tokenRateColor;
		if (isSettingColor(values.tokenRateColor)) {
			tokenRateColor = values.tokenRateColor;
		}
		let tokenRateColored = "";
		if (tokenRateText) {
			tokenRateColored = this.#ctx.ui.theme.fg(tokenRateColor, tokenRateText);
		}
		let tokenRate = tokenRateColored;
		if (tokenRateColored && values.tokenRateDimmed === true) {
			tokenRate = dimAttribute(tokenRateColored);
		}
		let elapsed = "";
		if (features.elapsedTime) {
			elapsed = formatElapsed(elapsedMs);
		}
		let tokens = "";
		if (features.outputTokens) {
			tokens = `↓ ${formatTokens(Math.max(0, Math.floor(elapsedMs / 1000 * TOKEN_RATE_PER_SEC)))} tokens`;
		}
		return buildWorkingMessage(this.#ctx.ui.theme, {
			spinner,
			text: styledWord,
			meter,
			elapsed,
			tokens,
			tokenRate,
		}, order);
	}
	private promptPreview(values: Record<string, boolean | string>): PreviewResult {
		if (values.decorateUserPrompt !== true) return { lines: ["User prompt decoration is disabled."] };

		const borderColor = values.borderColor;
		const borderStyle = values.borderStyle;
		const timestamp = values.promptTimestamp === true ? Date.now() : undefined;
		const lines = buildPromptBoxLines("ping", timestamp, PREVIEW_WIDTH, this.#ctx.ui.theme, {
			showIcon: values.promptIcon === true,
			showTimestamp: values.promptTimestamp === true,
			showProvider: values.promptProvider === true,
			showModel: values.promptModel === true,
			icon: values.useNerdFont ? "" : "π",
			provider: this.#ctx.model?.provider,
			model: this.#ctx.model?.id,
			borderColor: isSettingColor(borderColor) ? borderColor : DEFAULT_SETTINGS.decorations.borderColor,
			borderStyle: isBorderStyle(borderStyle) ? borderStyle : "double",
		});
		return timestamp === undefined
			? { lines }
			: { lines, nextRefreshInMs: 1_000 - (timestamp % 1_000) };
	}
	private markerPreview(values: Record<string, boolean | string>): PreviewResult {
		if (values.doneMarker !== true) return { lines: ["Completion marker is disabled."] };
		const theme = this.#ctx.ui.theme;
		const icon = values.doneMarkerIcon === true ? theme.fg("text", values.useNerdFont === true ? "" : "π") : "";
		const word = values.randomizeDoneMarker === true ? "Concocted" : "Worked";
		const details: string[] = [];
		if (values.doneMarkerTokens === true) details.push("↓ 949 tokens");
		if (values.doneMarkerInputs === true) details.push("2 mid-turn inputs");
		const content = buildCompletionMarkerContent(theme, icon, word, "2m 52s", details);
		const borderStyle = isDoneMarkerBorderStyle(values.doneMarkerBorderStyle) ? values.doneMarkerBorderStyle : "none";
		const borderColor = isSettingColor(values.doneMarkerBorderColor) ? values.doneMarkerBorderColor : DEFAULT_SETTINGS.decorations.doneMarkerBorderColor;
		const marker = buildCompletionMarkerLine(content, PREVIEW_WIDTH, theme, borderStyle, borderColor);
		return { lines: ["", marker, ""] };
	}
}
