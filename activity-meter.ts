import type { ThemeColor } from "@earendil-works/pi-coding-agent";

export const ActivityMeterLevel = {
	IDLE: 0,
	LOW: 1,
	MEDIUM: 2,
	HIGH: 3,
	PEAK_1: 4,
	PEAK_2: 5,
	PEAK_3: 6,
	FULL: 7,
} as const;

export type ActivityMeterLevel = (typeof ActivityMeterLevel)[keyof typeof ActivityMeterLevel];

const EMA_ALPHA = 0.4;
const BRAILLE: Record<ActivityMeterLevel, string> = {
	[ActivityMeterLevel.IDLE]: "⢀",
	[ActivityMeterLevel.LOW]: "⣀",
	[ActivityMeterLevel.MEDIUM]: "⣠",
	[ActivityMeterLevel.HIGH]: "⣤",
	[ActivityMeterLevel.PEAK_1]: "⣴",
	[ActivityMeterLevel.PEAK_2]: "⣶",
	[ActivityMeterLevel.PEAK_3]: "⣾",
	[ActivityMeterLevel.FULL]: "⣿",
};
const WIDTH = 8;
type CellColorizer = (level: ActivityMeterLevel, char: string) => string;

/** Convert an estimated output-token rate to a display level. */
export function rateToLevel(tokensPerSecond: number): ActivityMeterLevel {
	const THRESHOLDS = [0, 5, 10, 15, 22, 30, 40];
	for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
		if (tokensPerSecond > THRESHOLDS[i]) return (i + 1) as ActivityMeterLevel;
	}
	return 0;
}

/** EMA-smoothed rate tracker for a cumulative output-token estimate. */
export class TokRateTracker {
	#lastTotal = 0;
	#lastTime = 0;
	#rate = 0;
	#hasSample = false;

	sample(totalTokens: number, now: number): number {
		if (!this.#hasSample) {
			this.#lastTotal = totalTokens;
			this.#hasSample = true;
			this.#lastTime = now;
			return this.#rate;
		}

		const elapsedSeconds = (now - this.#lastTime) / 1_000;
		if (elapsedSeconds <= 0) return this.#rate;

		const instantRate = Math.max(0, (totalTokens - this.#lastTotal) / elapsedSeconds);
		this.#rate = EMA_ALPHA * instantRate + (1 - EMA_ALPHA) * this.#rate;
		this.#lastTotal = totalTokens;
		this.#lastTime = now;
		return this.#rate;
	}

	reset(): void {
		this.#lastTotal = 0;
		this.#lastTime = 0;
		this.#rate = 0;
		this.#hasSample = false;
	}
}

/** Eight-column, left-to-right scrolling activity meter. */
export class ActivityMeter {
	#levels: ActivityMeterLevel[] = Array<ActivityMeterLevel>(WIDTH).fill(0);

	push(level: ActivityMeterLevel): void {
		this.#levels.pop();
		this.#levels.unshift(level);
	}

	render(colorize?: CellColorizer): string {
		return this.#levels
			.map((level) => {
				const char = BRAILLE[level];
				return colorize ? colorize(level, char) : char;
			})
			.join("");
	}

	reset(): void {
		this.#levels.fill(0);
	}

	/** Colorize a meter cell using the default theme mapping (dim at IDLE, accent otherwise). */
	static colorizeCell(
		level: ActivityMeterLevel,
		char: string,
		theme: { fg: (style: ThemeColor, s: string) => string },
	): string {
		return level === ActivityMeterLevel.IDLE ? theme.fg("dim", char) : theme.fg("accent", char);
	}
}
