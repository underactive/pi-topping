import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

/** Pi's default working-indicator frames (same braille spinner as pi-tui's Loader). */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Milliseconds per spinner frame, matching pi-tui's Loader cadence. */
export const SPINNER_FRAME_MS = 80;

/** Default "Working…" text shown when text randomization/substitution is off. */
export const DEFAULT_WORKING_WORD = "Working…";

/** Milliseconds between activity meter sample pushes. */
export const METER_INTERVAL_MS = 100;

/** Milliseconds between shimmer re-renders. */
export const SHIMMER_INTERVAL_MS = 50;

/** Milliseconds between elapsed-time display updates. */
export const ELAPSED_INTERVAL_MS = 1_000;

/** A user-orderable piece of the working indicator. */
export type LoaderElement = "spinner" | "text" | "meter" | "elapsed" | "tokens" | "tokenRate";

/** Default first-use working-indicator element order. */
export const DEFAULT_LOADER_ORDER: readonly LoaderElement[] = ["spinner", "text", "meter", "tokenRate", "elapsed", "tokens"];

/** Elements share a detail group; separators and non-rate details are dimmed. */
const DETAIL_ELEMENTS: ReadonlySet<LoaderElement> = new Set(["elapsed", "tokens", "tokenRate"]);

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
export const TOKEN_RATE_PLACEHOLDER = `${"-".repeat(TOKEN_RATE_DIGITS)} tok/s`;

/** Format an output-token throughput estimate for the working indicator. */
export function formatTokenRate(rate: number): string {
	const rounded = Math.round(rate);
	return rounded === 0 ? "" : `${rounded.toString().padStart(TOKEN_RATE_DIGITS)} tok/s`;
}

/**
 * Wrap text in ANSI dim (SGR 2 / reset 22).
 *
 * theme.fg("dim", ...) sets a gray color instead of the ANSI dim attribute, so it
 * would overwrite an already-applied accent color rather than darkening it; the raw
 * SGR codes are needed to dim on top of an existing color.
 */
export function dimAttribute(text: string): string {
	return `\x1b[2m${text}\x1b[22m`;
}

/** Number of discrete, eased warning-to-dim shades used for the token-rate fade. */
export const TOKEN_RATE_FADE_SHADE_COUNT = 5;

/** Render one token-rate fade shade by blending the selected color toward the active theme's dim color. */
export function fadeThemeColorString(
	text: string,
	shade: number,
	theme: Pick<Theme, "getFgAnsi" | "fg">,
	color: ThemeColor,
): string {
	if (!text) return "";
	const source = ansiToRgb(theme.getFgAnsi(color));
	const dim = ansiToRgb(theme.getFgAnsi("dim"));
	if (!source || !dim) return theme.fg(color, text);
	const clampedShade = Math.max(0, Math.min(TOKEN_RATE_FADE_SHADE_COUNT - 1, Math.floor(shade)));
	const progress = (clampedShade + 1) / TOKEN_RATE_FADE_SHADE_COUNT;
	const eased = 0.5 * (1 - Math.cos(Math.PI * progress));
	const blended = source.map((channel, index) => Math.round(channel * (1 - eased) + dim[index]! * eased));
	return `\x1b[38;2;${blended[0]};${blended[1]};${blended[2]}m${text}\x1b[0m`;
}

/** Format elapsed milliseconds as a compact human-readable duration, skipping leading zero units. */
export function formatElapsed(ms: number): string {
	let totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const parts: string[] = [];

	const days = Math.floor(totalSeconds / 86400);
	totalSeconds -= days * 86400;
	const hours = Math.floor(totalSeconds / 3600);
	totalSeconds -= hours * 3600;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;

	if (days > 0) parts.push(`${days}d`);
	if (hours > 0) parts.push(`${hours}h`);
	if (minutes > 0) parts.push(`${minutes}m`);
	parts.push(`${seconds}s`);

	return parts.join(" ");
}

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
		if (DETAIL_ELEMENTS.has(element)) {
			// tokenRate arrives pre-colored; dimming it here would replace its configured color.
			details.push(element === "tokenRate" ? value : theme.fg("dim", value));
			continue;
		}
		flushDetails();
		segments.push(value);
	}
	flushDetails();

	return segments.join(" ");
}

const SHIMMER_SWEEP_S = 2.0;
const SHIMMER_BAND_HALF = 5.0;
const SHIMMER_PADDING = 10;

/**
 * Codex-style light-sweep shimmer using the active Pi theme.
 *
 * With `invert=true`, the text color is used at rest and the sweep moves toward
 * the theme's dim color.
 */
export function shimmerString(
	text: string,
	elapsedMs: number,
	theme: Pick<Theme, "getFgAnsi" | "fg">,
	direction: "ltr" | "rtl" = "ltr",
	speed: "slow" | "normal" | "fast" = "normal",
	invert = false,
): string {
	const chars = [...text];
	if (chars.length === 0) return "";
	const shimmerBase = ansiToRgb(theme.getFgAnsi(invert ? "text" : "dim"));
	const shimmerHighlight = ansiToRgb(theme.getFgAnsi(invert ? "dim" : "text"));
	if (!shimmerBase || !shimmerHighlight) return theme.fg("text", text);
	const period = chars.length + SHIMMER_PADDING * 2;
	const unitsPerS = period / SHIMMER_SWEEP_S;
	// The band crosses padding at either end while every character is still dim. Scaling only
	// the stretch where it actually overlaps the text keeps that dark pause identical at every
	// speed, so `speed` changes the sweep alone rather than the whole cycle.
	const litEnter = SHIMMER_PADDING - SHIMMER_BAND_HALF;
	const litExit = SHIMMER_PADDING + chars.length - 1 + SHIMMER_BAND_HALF;
	const enterS = litEnter / unitsPerS;
	const litS = (litExit - litEnter) / unitsPerS / (speed === "slow" ? 0.5 : speed === "fast" ? 2 : 1);
	const phase = (elapsedMs / 1000) % (enterS + litS + (period - litExit) / unitsPerS);
	const linear = phase < enterS
		? phase * unitsPerS
		: phase < enterS + litS
			? litEnter + ((phase - enterS) / litS) * (litExit - litEnter)
			: litExit + (phase - enterS - litS) * unitsPerS;
	const pos = direction === "rtl" ? period - linear : linear;

	let out = "";
	for (let i = 0; i < chars.length; i++) {
		const ch = chars[i];
		const dist = Math.abs((i + SHIMMER_PADDING) - pos);
		const t = dist <= SHIMMER_BAND_HALF
			? 0.5 * (1 + Math.cos(Math.PI * dist / SHIMMER_BAND_HALF))
			: 0;
		const alpha = t * 0.9;
		const r = Math.round(shimmerHighlight[0] * alpha + shimmerBase[0] * (1 - alpha));
		const g = Math.round(shimmerHighlight[1] * alpha + shimmerBase[1] * (1 - alpha));
		const b = Math.round(shimmerHighlight[2] * alpha + shimmerBase[2] * (1 - alpha));
		const bold = !invert && t > 0.2 ? "\x1b[1m" : "";
		out += `${bold}\x1b[38;2;${r};${g};${b}m${ch}\x1b[22m`;
	}
	return out + "\x1b[0m";
}

function ansiToRgb(ansi: string): [number, number, number] | null {
	const match = ansi.match(/^\x1b\[38;2;(\d+);(\d+);(\d+)m$/);
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Incremental whitespace-boundary word counter.
 *
 * The in-word state is retained across streaming chunks so a word split across
 * multiple deltas is counted exactly once.
 */
export class StreamingWordCounter {
	#inWordByStream = new Map<string, boolean>();

	count(text: string, stream = "default"): number {
		let inWord = this.#inWordByStream.get(stream) ?? false;
		let count = 0;
		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);
			if (isWhitespace(code)) {
				inWord = false;
			} else if (!inWord) {
				count++;
				inWord = true;
			}
		}
		this.#inWordByStream.set(stream, inWord);
		return count;
	}

	reset(): void {
		this.#inWordByStream.clear();
	}
}

function isWhitespace(code: number): boolean {
	return (
		code === 32 ||
		(code >= 9 && code <= 13) ||
		code === 160 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000 ||
		code === 0xfeff
	);
}
