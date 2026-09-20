import type { Theme } from "@earendil-works/pi-coding-agent";
import { getThinkingLevelColorizer, type ThinkingLevel } from "./format.ts";
import type { ThinkingLevelColor, ThinkingLevelSettingColor } from "./settings.ts";

/** Provider id whose working-loader response model uses NVIDIA green. */
export const SWITCHYARD_PROVIDER = "switchyard";

/** Bright NVIDIA green shared with pi-topping-statusline's Switchyard border. */
export const NVIDIA_GREEN_HEX = "#84c51a";

const NVIDIA_GREEN_RGB = [1, 3, 5].map((offset) => Number.parseInt(NVIDIA_GREEN_HEX.slice(offset, offset + 2), 16));
const NVIDIA_GREEN_ANSI = `\x1b[38;2;${NVIDIA_GREEN_RGB.join(";")}m`;

export function isSwitchyardProvider(provider: string | undefined): boolean {
	return provider?.trim().toLowerCase() === SWITCHYARD_PROVIDER;
}

export function colorizeNvidiaGreen(text: string): string {
	return `${NVIDIA_GREEN_ANSI}${text}\x1b[39m`;
}

/**
 * Build the working-loader response-model colorizer.
 *
 * Switchyard always uses NVIDIA green; other providers retain the configured
 * theme/thinking-level color.
 */
export function getResponseModelColorizer(
	theme: Pick<Theme, "fg" | "getThinkingBorderColor">,
	color: ThinkingLevelColor | ThinkingLevelSettingColor,
	thinkingLevel: ThinkingLevel | undefined,
	provider: string | undefined,
): (text: string) => string {
	return isSwitchyardProvider(provider)
		? colorizeNvidiaGreen
		: getThinkingLevelColorizer(theme, color, thinkingLevel);
}
