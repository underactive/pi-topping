import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ActivityMeter, rateToLevel } from "./activity-meter.ts";
import { buildWorkingMessage, formatElapsed, formatTokens, isFullyDefaultAppearance, shimmerString } from "./format.ts";
import { pickRandomWord } from "./words.ts";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const METER_INTERVAL_MS = 100;
const METER_PERIOD_MS = 2400;
const METER_PEAK_RATE = 46;
const TOKEN_RATE_PER_SEC = 28;
const DEFAULT_WORKING_WORD = "Working…";

function meterRate(elapsedMs: number): number {
	return ((1 - Math.cos((2 * Math.PI * elapsedMs) / METER_PERIOD_MS)) / 2) * METER_PEAK_RATE;
}

/** Stateful, per-menu live preview renderer. */
export class PreviewRenderer {
	readonly #word = pickRandomWord();
	readonly #meter = new ActivityMeter();
	#lastMeterUpdate = 0;
	readonly #ctx: ExtensionContext;

	constructor(ctx: ExtensionContext) { this.#ctx = ctx; }

	render(values: Record<string, boolean>, elapsedMs: number): string[] {
		this.#meter.setDirection(values.meterDirection_rtl ? "rtl" : "ltr");
		if (elapsedMs - this.#lastMeterUpdate >= METER_INTERVAL_MS) {
			this.#meter.push(rateToLevel(meterRate(elapsedMs)));
			this.#lastMeterUpdate = elapsedMs;
		}
		const features = {
			substituteDefaultMessage: values.substituteDefaultMessage ?? true,
			elapsedTime: values.elapsedTime ?? true,
			outputTokens: values.outputTokens ?? true,
		};
		const decorations = { shimmer: values.shimmer ?? true, tokenActivityMonitor: values.tokenActivityMonitor ?? true };
		const spinner = values.animatedSpinner
			? this.#ctx.ui.theme.fg("accent", SPINNER_FRAMES[Math.floor(elapsedMs / 80) % SPINNER_FRAMES.length]!)
			: "";
		if (isFullyDefaultAppearance(features, decorations)) return [[spinner, this.#ctx.ui.theme.fg("dim", DEFAULT_WORKING_WORD)].filter(Boolean).join(" ")];
		const word = features.substituteDefaultMessage ? this.#word : DEFAULT_WORKING_WORD;
		const styledWord = decorations.shimmer ? shimmerString(word, elapsedMs, this.#ctx.ui.theme) : this.#ctx.ui.theme.fg("text", word);
		const meter = decorations.tokenActivityMonitor ? this.#meter.render((level, char) => ActivityMeter.colorizeCell(level, char, this.#ctx.ui.theme)) : "";
		return [[spinner, buildWorkingMessage(this.#ctx.ui.theme, styledWord, meter, formatElapsed(elapsedMs), formatTokens(Math.max(0, Math.floor(elapsedMs / 1000 * TOKEN_RATE_PER_SEC))), features)].filter(Boolean).join(" ")];
	}
}
