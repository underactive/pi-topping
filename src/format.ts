import type { Theme } from "@earendil-works/pi-coding-agent";

/** Pi's default working-indicator frames (same braille spinner as pi-tui's Loader). */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Milliseconds per spinner frame, matching pi-tui's Loader cadence. */
export const SPINNER_FRAME_MS = 80;

/** Default "Working" text shown when text randomization/substitution is off. */
export const DEFAULT_WORKING_WORD = "Working";

export type ThinkingLevel = Parameters<Theme["getThinkingBorderColor"]>[0];

export const THINKING_LEVEL_VALUES = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

export function isThinkingLevel(value: unknown): value is ThinkingLevel {
	return typeof value === "string" && THINKING_LEVEL_VALUES.some(level => level === value);
}

/** Milliseconds between activity meter sample pushes. */
export const METER_INTERVAL_MS = 100;

/** Milliseconds between shimmer re-renders. */
export const SHIMMER_INTERVAL_MS = 50;

/** Milliseconds between elapsed-time display updates. */
export const ELAPSED_INTERVAL_MS = 1_000;

/** A user-orderable piece of the working indicator. */
export type LoaderElement = "spinner" | "text" | "meter" | "elapsed" | "tokens" | "tokenRate" | "responseModel";

/** Default first-use working-indicator element order. */
export const DEFAULT_LOADER_ORDER: readonly LoaderElement[] = ["spinner", "text", "meter", "tokenRate", "elapsed", "tokens", "responseModel"];

/** Elements share a detail group; "raw" details arrive pre-colored and must not be dimmed. */
const DETAIL_STYLES = new Map<LoaderElement, "muted" | "raw">([
	["elapsed", "muted"],
	["tokens", "muted"],
	["tokenRate", "raw"],
	["responseModel", "raw"],
]);

const TOKEN_UNITS = [
	{ threshold: 10_000, divisor: 1_000, decimals: 1, suffix: "k" },
	{ threshold: 999_500, divisor: 1_000, decimals: 0, suffix: "k" },
	{ threshold: 10_000_000, divisor: 1_000_000, decimals: 1, suffix: "M" },
	{ threshold: 1_000_000_000, divisor: 1_000_000, decimals: 0, suffix: "M" },
	{ threshold: 1e15, divisor: 1_000_000_000, decimals: 1, suffix: "B" },
] as const;

/** Format an output-token count for the working indicator. */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	const unit = TOKEN_UNITS.find(u => count < u.threshold);
	if (unit) {
		const value = unit.decimals > 0
			? (count / unit.divisor).toFixed(unit.decimals)
			: `${Math.round(count / unit.divisor)}`;
		return `${value}${unit.suffix}`;
	}
	return `${(count / 1_000_000_000).toFixed(1)}B`;
}

/** Column width reserved for the numeric portion of the token-rate readout. */
const TOKEN_RATE_DIGITS = 3;

/** Placeholder shown when the working indicator has no active token-rate sample. */
export const TOKEN_RATE_PLACEHOLDER = `${"-".repeat(TOKEN_RATE_DIGITS)} tps`;

/** Format an output-token throughput estimate for the working indicator. */
export function formatTokenRate(rate: number): string {
	const rounded = Math.round(rate);
	return rounded === 0 ? "" : `${rounded.toString().padStart(TOKEN_RATE_DIGITS)} tps`;
}

/** Milliseconds a settled response model remains fully visible before fading. */
export const RESPONSE_MODEL_HOLD_MS = 3_000;

/** Milliseconds over which a settled response model fades through the theme shades. */
export const RESPONSE_MODEL_FADE_MS = 500;

/** Milliseconds between working-loader repaints while the response model slides out. */
export const RESPONSE_MODEL_SLIDE_FRAME_MS = 30;

/** True when every appearance toggle is off and Pi's stock loader can be restored. */
export function isFullyDefaultAppearance(features: {
	substituteDefaultMessage: boolean;
	elapsedTime: boolean;
	outputTokens: boolean;
	tokenRate: boolean;
}, decorations: { shimmer: boolean; tokenActivityMonitor: boolean }): boolean {
	return !features.substituteDefaultMessage && !decorations.shimmer && !decorations.tokenActivityMonitor && !features.elapsedTime && !features.outputTokens && !features.tokenRate;
}

/**
 * Assemble the working indicator from already-styled pieces, laid out in `order`.
 *
 * Empty/omitted pieces are dropped, and any run of detail elements left adjacent
 * after that renders as one visual group with dim separators.
 */
export function buildWorkingMessage(
	theme: Pick<Theme, "fg">,
	parts: Partial<Record<LoaderElement, string>>,
	order: readonly LoaderElement[] = DEFAULT_LOADER_ORDER,
): string {
	const segments: string[] = [];
	let details: string[] = [];
	const flushDetails = (): void => {
		if (details.length) segments.push(details.join(theme.fg("dim", " · ")));
		details = [];
	};

	for (const element of order) {
		const value = parts[element];
		if (!value) continue;
		const style = DETAIL_STYLES.get(element);
		if (style) {
			details.push(style === "raw" ? value : theme.fg("muted", value));
			continue;
		}
		flushDetails();
		segments.push(value);
	}
	flushDetails();

	return segments.join(" ");
}
