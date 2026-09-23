import type { Theme } from "@earendil-works/pi-coding-agent";
import { buildWorkingMessage, DEFAULT_WORKING_WORD, dimAttribute, fadeThemeColorString, formatElapsed, formatTokens, getThinkingLevelColorizer, isFullyDefaultAppearance, shimmerString, SPINNER_FRAME_MS, SPINNER_FRAMES, TOKEN_RATE_PLACEHOLDER, type LoaderElement, type ThinkingLevel } from "./format.ts";
import { getResponseModelColorizer } from "./nvidia-green.ts";
import type { DecoratorSettings } from "./settings.ts";

type Features = Pick<DecoratorSettings["features"], "substituteDefaultMessage" | "elapsedTime" | "outputTokens" | "tokenRate" | "responseModel">;
type Decorations = Pick<DecoratorSettings["decorations"], "shimmer" | "shimmerInverted" | "shimmerDirection" | "shimmerSpeed" | "tokenActivityMonitor" | "meterColor" | "meterDimmed" | "tokenRateColor" | "tokenRateDimmed" | "responseModelColor" | "responseModelDimmed" | "spinnerColor">;
interface LoaderParts {
	spinnerAtMs?: number;
	word: string;
	shimmerAtMs?: number;
	renderMeter?: (colorizer: (text: string) => string, dimmed: boolean) => string;
	elapsedMs?: number;
	outputTokens?: number;
	tokenRateText?: string;
	tokenRateShade?: number;
	responseModel?: string;
}

/** Assemble the live and preview loaders with identical styling and ordering. */
export function buildLoaderMessage(
	theme: Theme,
	thinkingLevel: ThinkingLevel | undefined,
	provider: string | undefined,
	features: Features,
	decorations: Decorations,
	loaderOrder: readonly LoaderElement[],
	parts: LoaderParts,
): string {
	const spinner = parts.spinnerAtMs === undefined ? "" : getThinkingLevelColorizer(theme, decorations.spinnerColor, thinkingLevel)(SPINNER_FRAMES[Math.floor(parts.spinnerAtMs / SPINNER_FRAME_MS) % SPINNER_FRAMES.length]!);
	const responseModelColored = parts.responseModel ? getResponseModelColorizer(theme, decorations.responseModelColor, thinkingLevel, provider)(parts.responseModel) : "";
	const responseModel = responseModelColored && decorations.responseModelDimmed ? dimAttribute(responseModelColored) : responseModelColored;
	if (isFullyDefaultAppearance(features, decorations)) {
		return buildWorkingMessage(theme, { spinner, text: theme.fg("dim", DEFAULT_WORKING_WORD), responseModel }, loaderOrder);
	}
	const word = features.substituteDefaultMessage ? parts.word : DEFAULT_WORKING_WORD;
	const text = decorations.shimmer && parts.shimmerAtMs !== undefined
		? shimmerString(word, parts.shimmerAtMs, theme, decorations.shimmerDirection, decorations.shimmerSpeed, decorations.shimmerInverted)
		: theme.fg("text", word);
	const meter = decorations.tokenActivityMonitor && parts.renderMeter
		? parts.renderMeter(getThinkingLevelColorizer(theme, decorations.meterColor, thinkingLevel), decorations.meterDimmed)
		: "";
	let tokenRate = "";
	if (features.tokenRate) {
		if (!parts.tokenRateText) tokenRate = theme.fg("dim", TOKEN_RATE_PLACEHOLDER);
		else {
			const colorizer = getThinkingLevelColorizer(theme, decorations.tokenRateColor, thinkingLevel);
			tokenRate = parts.tokenRateShade === undefined ? colorizer(parts.tokenRateText) : fadeThemeColorString(parts.tokenRateText, parts.tokenRateShade, theme, colorizer);
		}
		if (tokenRate && decorations.tokenRateDimmed) tokenRate = dimAttribute(tokenRate);
	}
	return buildWorkingMessage(theme, {
		spinner, text, meter,
		elapsed: features.elapsedTime && parts.elapsedMs !== undefined ? formatElapsed(parts.elapsedMs) : "",
		tokens: features.outputTokens && parts.outputTokens !== undefined ? `↓ ${formatTokens(parts.outputTokens)} tokens` : "",
		tokenRate, responseModel,
	}, loaderOrder);
}
