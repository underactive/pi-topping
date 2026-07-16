/** Format an output-token count for the working indicator. */
export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	const UNITS = [
		{ threshold: 10_000, divisor: 1_000, decimals: 1, suffix: "k" },
		{ threshold: 999_500, divisor: 1_000, decimals: 0, suffix: "k" },
		{ threshold: 10_000_000, divisor: 1_000_000, decimals: 1, suffix: "M" },
	];
	const unit = UNITS.find(u => count < u.threshold);
	if (unit) {
		const value = unit.decimals > 0
			? (count / unit.divisor).toFixed(unit.decimals)
			: `${Math.round(count / unit.divisor)}`;
		return `${value}${unit.suffix}`;
	}
	return `${Math.round(count / 1_000_000)}M`;
}

/** Format elapsed milliseconds as minutes and zero-padded seconds. */
export function formatElapsed(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
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
