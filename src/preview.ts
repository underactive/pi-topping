import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_PREVIEW_WIDTH, type PreviewResult } from "./menu.ts";
import { ActivityMeter, rateToLevel } from "./activity-meter.ts";
import { buildWorkingMessage, DEFAULT_WORKING_WORD, dimAttribute, ELAPSED_INTERVAL_MS, formatElapsed, formatTokenRate, formatTokens, getThinkingLevelColorizer, isFullyDefaultAppearance, METER_INTERVAL_MS, SHIMMER_INTERVAL_MS, shimmerString, spinnerFrame, SPINNER_FRAME_MS, SPINNER_FRAMES } from "./format.ts";
import { buildCompletionMarkerContent, buildCompletionMarkerLine, buildPromptBoxLines } from "./prompt-decorator.ts";
import { DEFAULT_SETTINGS, fromCycleDirection, fromCycleSpeed, isBorderStyle, isDoneMarkerBorderColor, isDoneMarkerBorderStyle, isDoneMarkerStyle, isPromptBorderColor, isSpinnerColor, isThinkingLevelColor, LOADER_ORDER_ID, MENU_ENTRIES, parseLoaderOrder } from "./settings.ts";
import { isWordPackEnabled, selectWorkingTextSelection, wordPacksPath, type WordPack } from "./word-packs.ts";
import { pickRandomWord } from "./words.ts";
// Simulated load for the menu preview: a 2.4s cosine wave peaking at 46 tps for the meter,
// flat 28 tps for the token readouts.
const METER_PERIOD_MS = 2400, METER_PEAK_RATE = 46, TOKEN_RATE_PER_SEC = 28;
const PROMPT_IDS = new Set(MENU_ENTRIES.filter(entry => entry.section === "User Prompt").map(entry => entry.id));
const MARKER_IDS = new Set(MENU_ENTRIES.filter(entry => entry.section === "Completion Marker").map(entry => entry.id));
function meterRate(elapsedMs: number): number { return ((1 - Math.cos((2 * Math.PI * elapsedMs) / METER_PERIOD_MS)) / 2) * METER_PEAK_RATE; }

/** Stateful, per-menu preview renderer that follows the active settings section. */
export class PreviewRenderer {
	// Preserve constructor-time randomness so rendering never changes the preview phrase.
	readonly #word = pickRandomWord();
	readonly #poolFraction = Math.random();
	readonly #packs: readonly WordPack[];
	readonly #meter = new ActivityMeter();
	#lastMeterUpdate = 0;
	#cachedPackWord = "";
	#cachedPackSignature = "";
	readonly #ctx: ExtensionContext;
	constructor(ctx: ExtensionContext, packs: readonly WordPack[] = []) {
		this.#ctx = ctx;
		this.#packs = packs;
	}
	render(values: Record<string, boolean | string>, elapsedMs: number, activeItemId?: string, width: number = DEFAULT_PREVIEW_WIDTH): PreviewResult {
		if (PROMPT_IDS.has(activeItemId ?? "")) return this.promptPreview(values, width);
		if (MARKER_IDS.has(activeItemId ?? "")) return this.markerPreview(values, width);
		if (activeItemId === "useNerdFont") return { lines: ["", `Icon preview: ${values.useNerdFont ? "" : "π"}`, ""] };
		if (activeItemId?.startsWith("pack:")) return this.packPreview(activeItemId.slice("pack:".length), values);
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
		const features = { substituteDefaultMessage: values.substituteDefaultMessage !== false, elapsedTime: values.elapsedTime !== false, outputTokens: values.outputTokens !== false, tokenRate: values.showTokenRate !== false, responseModel: values.showResponseModel !== false };
		const decorations = { shimmer: values.shimmer !== false, shimmerInverted: values.shimmerInverted === true, tokenActivityMonitor: values.tokenActivityMonitor !== false };
		let spinnerColor = DEFAULT_SETTINGS.decorations.spinnerColor;
		if (values.spinnerColorEnabled !== false && isSpinnerColor(values.spinnerColor)) {
			spinnerColor = values.spinnerColor;
		}
		let spinner = "";
		if (values.animatedSpinner !== false) {
			spinner = spinnerFrame(this.#ctx.ui.theme, spinnerColor, this.#ctx.thinkingLevel, SPINNER_FRAMES[Math.floor(elapsedMs / SPINNER_FRAME_MS) % SPINNER_FRAMES.length]!);
		}
		const order = parseLoaderOrder(values[LOADER_ORDER_ID]);
		let responseModelColor = DEFAULT_SETTINGS.decorations.responseModelColor;
		if (isThinkingLevelColor(values.responseModelColor)) responseModelColor = values.responseModelColor;
		const responseModelColorizer = getThinkingLevelColorizer(this.#ctx.ui.theme, responseModelColor, this.#ctx.thinkingLevel);
		const responseModelColored = features.responseModel ? responseModelColorizer("test-model") : "";
		const responseModel = responseModelColored && values.responseModelDimmed === true ? dimAttribute(responseModelColored) : responseModelColored;
		if (isFullyDefaultAppearance(features, decorations)) {
			return buildWorkingMessage(this.#ctx.ui.theme, { spinner, text: this.#ctx.ui.theme.fg("dim", DEFAULT_WORKING_WORD), responseModel }, order);
		}
		let word = DEFAULT_WORKING_WORD;
		if (features.substituteDefaultMessage) {
			const packValues = this.packValues(values);
			const signature = JSON.stringify(Object.keys(packValues).sort().map(k => `${k}=${packValues[k]}`));
			if (signature !== this.#cachedPackSignature) {
				const enabledPacks = this.#packs.filter((pack) => isWordPackEnabled(pack.id, packValues));
				this.#cachedPackWord = enabledPacks.length ? selectWorkingTextSelection(packValues, this.#packs, this.#poolFraction).text : this.#word;
				this.#cachedPackSignature = signature;
			}
			word = this.#cachedPackWord;
		}
		let styledWord: string;
		if (decorations.shimmer) {
			styledWord = shimmerString(word, elapsedMs, this.#ctx.ui.theme, fromCycleDirection(values.shimmerDirection), fromCycleSpeed(values.shimmerSpeed), decorations.shimmerInverted);
		} else {
			styledWord = this.#ctx.ui.theme.fg("text", word);
		}
		let meterColor = DEFAULT_SETTINGS.decorations.meterColor;
		if (values.meterColorEnabled !== false && isThinkingLevelColor(values.meterColor)) {
			meterColor = values.meterColor;
		}
		let meter = "";
		if (decorations.tokenActivityMonitor) {
			const meterColorizer = getThinkingLevelColorizer(this.#ctx.ui.theme, meterColor, this.#ctx.thinkingLevel);
			meter = this.#meter.render((level, char) => ActivityMeter.colorizeCell(level, char, this.#ctx.ui.theme, meterColorizer, values.meterDimmed === true));
		}
		let tokenRateText = "";
		if (features.tokenRate) {
			tokenRateText = formatTokenRate(TOKEN_RATE_PER_SEC);
		}
		let tokenRateColor = DEFAULT_SETTINGS.decorations.tokenRateColor;
		if (isThinkingLevelColor(values.tokenRateColor)) {
			tokenRateColor = values.tokenRateColor;
		}
		let tokenRateColored = "";
		if (tokenRateText) {
			const tokenRateColorizer = getThinkingLevelColorizer(this.#ctx.ui.theme, tokenRateColor, this.#ctx.thinkingLevel);
			tokenRateColored = tokenRateColorizer(tokenRateText);
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
			responseModel,
		}, order);
	}
	private packValues(values: Record<string, boolean | string>): Record<string, boolean> {
		const enabled: Record<string, boolean> = {};
		for (const pack of this.#packs) {
			const value = values[`pack:${pack.id}`];
			if (typeof value === "boolean") enabled[pack.id] = value;
		}
		return enabled;
	}
	private packPreview(id: string, values: Record<string, boolean | string>): PreviewResult {
		const pack = this.#packs.find((candidate) => candidate.id === id);
		if (!pack) return { lines: ["This word pack is unavailable."] };
		const enabled = isWordPackEnabled(id, this.packValues(values));
		const source = pack.bundled ? "Shipped example" : `Custom: ${wordPacksPath()}`;
		return { lines: [`${pack.name}: ${enabled ? "enabled" : "disabled"}`, `${pack.words.length} phrases · ${source}`, ...(pack.description ? [pack.description] : [])] };
	}
	private promptPreview(values: Record<string, boolean | string>, width: number): PreviewResult {
		if (values.decorateUserPrompt !== true) return { lines: ["User prompt decoration is disabled."] };

		const borderColor = values.borderColor;
		const borderStyle = values.borderStyle;
		const timestamp = values.promptTimestamp === true ? Date.now() : undefined;
		const lines = buildPromptBoxLines("ping", timestamp, width, this.#ctx.ui.theme, {
			showIcon: values.promptIcon === true,
			showTimestamp: values.promptTimestamp === true,
			showProvider: values.promptProvider === true,
			showModel: values.promptModel === true,
			icon: values.useNerdFont ? "" : "π",
			provider: this.#ctx.model?.provider,
			model: this.#ctx.model?.id,
			borderColor: isPromptBorderColor(borderColor) ? borderColor : DEFAULT_SETTINGS.decorations.borderColor,
			borderStyle: isBorderStyle(borderStyle) ? borderStyle : "double",
			thinkingLevel: this.#ctx.thinkingLevel,
		});
		return timestamp === undefined
			? { lines }
			: { lines, nextRefreshInMs: 1_000 - (timestamp % 1_000) };
	}
	private markerPreview(values: Record<string, boolean | string>, width: number): PreviewResult {
		if (values.doneMarker !== true) return { lines: ["Completion marker is disabled."] };
		const theme = this.#ctx.ui.theme;
		const icon = values.doneMarkerIcon === true ? theme.fg("text", values.useNerdFont === true ? "" : "π") : "";
		const word = values.randomizeDoneMarker === true ? "Concocted" : "Worked";
		const details: string[] = [];
		if (values.doneMarkerTokens === true) details.push("↓ 949 tokens");
		if (values.doneMarkerInputs === true) details.push("2 mid-turn inputs");
		const content = buildCompletionMarkerContent(theme, icon, word, "2m 52s", details);
		const borderStyle = isDoneMarkerBorderStyle(values.doneMarkerBorderStyle) ? values.doneMarkerBorderStyle : "none";
		const borderColor = isDoneMarkerBorderColor(values.doneMarkerBorderColor) ? values.doneMarkerBorderColor : DEFAULT_SETTINGS.decorations.doneMarkerBorderColor;
		const markerStyle = isDoneMarkerStyle(values.doneMarkerStyle) ? values.doneMarkerStyle : DEFAULT_SETTINGS.decorations.doneMarkerStyle;
		const marker = buildCompletionMarkerLine(content, width, theme, borderStyle, borderColor, markerStyle, this.#ctx.thinkingLevel);
		return { lines: ["", marker, ""] };
	}
}
