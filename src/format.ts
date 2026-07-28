import type { Theme } from "@earendil-works/pi-coding-agent";

/** Pi's default working-indicator frames (same braille spinner as pi-tui's Loader). */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Milliseconds per spinner frame, matching pi-tui's Loader cadence. */
export const SPINNER_FRAME_MS = 80;

/** A user-orderable piece of the working indicator. */
export type LoaderElement = "spinner" | "text" | "meter" | "elapsed" | "tokens";

/** Left-to-right element order matching pi's stock working indicator. */
export const DEFAULT_LOADER_ORDER: readonly LoaderElement[] = ["spinner", "text", "meter", "elapsed", "tokens"];

/** Elements rendered inside the dim parenthetical rather than as standalone segments. */
const DETAIL_ELEMENTS: ReadonlySet<LoaderElement> = new Set(["elapsed", "tokens"]);

/** Format an output-token count for the working indicator. */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	const UNITS = [
		{ threshold: 10_000, divisor: 1_000, decimals: 1, suffix: "k" },
		{ threshold: 999_500, divisor: 1_000, decimals: 0, suffix: "k" },
		{ threshold: 10_000_000, divisor: 1_000_000, decimals: 1, suffix: "M" },
		{ threshold: 1_000_000_000, divisor: 1_000_000, decimals: 0, suffix: "M" },
		{ threshold: 1e15, divisor: 1_000_000_000, decimals: 1, suffix: "B" },
	];
	const unit = UNITS.find(u => count < u.threshold);
	if (unit) {
		const value = unit.decimals > 0
			? (count / unit.divisor).toFixed(unit.decimals)
			: `${Math.round(count / unit.divisor)}`;
		return `${value}${unit.suffix}`;
	}
	return `${(count / 1_000_000_000).toFixed(1)}B`;
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

/** Codex-style light-sweep shimmer using the active Pi theme. */
export function isFullyDefaultAppearance(features: {
	substituteDefaultMessage: boolean;
	elapsedTime: boolean;
	outputTokens: boolean;
}, decorations: { shimmer: boolean; tokenActivityMonitor: boolean }): boolean {
	return !features.substituteDefaultMessage && !decorations.shimmer && !decorations.tokenActivityMonitor && !features.elapsedTime && !features.outputTokens;
}

/**
 * Assemble the working indicator from already-styled pieces, laid out in `order`.
 *
 * Empty/omitted pieces are dropped, and any run of detail elements left adjacent
 * after that collapses into a single dim parenthetical.
 */
export function buildWorkingMessage(
	theme: Pick<Theme, "fg">,
	parts: Partial<Record<LoaderElement, string>>,
	order: readonly LoaderElement[] = DEFAULT_LOADER_ORDER,
): string {
	const segments: string[] = [];
	let details: string[] = [];
	const flushDetails = (): void => {
		if (details.length) segments.push(theme.fg("dim", `(${details.join(" · ")})`));
		details = [];
	};

	for (const element of order) {
		const value = parts[element];
		if (!value) continue;
		if (DETAIL_ELEMENTS.has(element)) {
			details.push(value);
			continue;
		}
		flushDetails();
		segments.push(value);
	}
	flushDetails();

	return segments.join(" ");
}

export function shimmerString(
	text: string,
	elapsedMs: number,
	theme: Pick<Theme, "getFgAnsi">,
	direction: "ltr" | "rtl" = "ltr",
	speed: "slow" | "normal" | "fast" = "normal",
): string {
	const chars = [...text];
	if (chars.length === 0) return "";
	const SHIMMER_SWEEP_S = 2.0;
	const SHIMMER_BAND_HALF = 5.0;
	const SHIMMER_PADDING = 10;
	const SHIMMER_BASE = ansiToRgb(theme.getFgAnsi("dim"));
	const SHIMMER_HIGHLIGHT = ansiToRgb(theme.getFgAnsi("text"));
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

	return chars
		.map((ch, i) => {
			const dist = Math.abs((i + SHIMMER_PADDING) - pos);
			const t = dist <= SHIMMER_BAND_HALF
				? 0.5 * (1 + Math.cos(Math.PI * dist / SHIMMER_BAND_HALF))
				: 0;
			const alpha = t * 0.9;
			const r = Math.round(SHIMMER_HIGHLIGHT[0] * alpha + SHIMMER_BASE[0] * (1 - alpha));
			const g = Math.round(SHIMMER_HIGHLIGHT[1] * alpha + SHIMMER_BASE[1] * (1 - alpha));
			const b = Math.round(SHIMMER_HIGHLIGHT[2] * alpha + SHIMMER_BASE[2] * (1 - alpha));
			const bold = t > 0.2 ? "\x1b[1m" : "";
			return `${bold}\x1b[38;2;${r};${g};${b}m${ch}\x1b[22m`;
		})
		.join("") + "\x1b[0m";
}

function ansiToRgb(ansi: string): [number, number, number] {
	const match = ansi.match(/^\x1b\[38;2;(\d+);(\d+);(\d+)m$/);
	if (!match) throw new Error(`Shimmer requires truecolor theme colors, received ${JSON.stringify(ansi)}`);
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
