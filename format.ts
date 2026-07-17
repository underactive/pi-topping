import type { Theme } from "@earendil-works/pi-coding-agent";

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

/** Assemble the styled word, meter, and optional detail fields. */
export function buildWorkingMessage(
	theme: Pick<Theme, "fg">,
	word: string,
	frame: string,
	elapsed: string,
	tokens: string,
	features: { elapsedTime: boolean; outputTokens: boolean },
): string {
	const parts = [word, frame].filter(Boolean);
	const details = [features.elapsedTime ? elapsed : "", features.outputTokens ? `↓ ${tokens} tokens` : ""].filter(Boolean);
	if (details.length) parts.push(theme.fg("dim", `(${details.join(" · ")})`));
	return parts.join(" ");
}

export function shimmerString(
	text: string,
	elapsedMs: number,
	theme: Pick<Theme, "fg" | "bold">,
): string {
	const chars = [...text];
	if (chars.length === 0) return "";
	const SHIMMER_SWEEP_S = 2.0;
	const SHIMMER_BAND_HALF = 5.0;
	const SHIMMER_PADDING = 10;
	const period = chars.length + SHIMMER_PADDING * 2;
	const elapsedS = elapsedMs / 1000;
	const pos = ((elapsedS % SHIMMER_SWEEP_S) / SHIMMER_SWEEP_S) * period;

	return chars
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
		.join("");
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
