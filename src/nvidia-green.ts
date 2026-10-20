import type { Theme } from "@earendil-works/pi-coding-agent";
import { thinkingLevelColorizer } from "@underactive/pi-topping-primitives/activity-tui";
import {
	hexToFgAnsi,
	isSwitchyardProvider,
	NVIDIA_GREEN_HEX,
	SWITCHYARD_PROVIDER,
} from "@underactive/pi-topping-primitives/color";
import type { ThinkingLevel } from "./format.ts";
import type { ThinkingLevelColor } from "./settings.ts";

/**
 * The Switchyard provider id, the bright NVIDIA green it shares with pi-topping-statusline's
 * Switchyard border, and the case- and space-insensitive provider check.
 */
export { isSwitchyardProvider, NVIDIA_GREEN_HEX, SWITCHYARD_PROVIDER };

/** Always truecolor, as the response-model colorizer has always been. */
const NVIDIA_GREEN_ANSI = hexToFgAnsi(NVIDIA_GREEN_HEX, "truecolor");

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
	color: ThinkingLevelColor,
	thinkingLevel: ThinkingLevel | undefined,
	provider: string | undefined,
): (text: string) => string {
	return isSwitchyardProvider(provider)
		? colorizeNvidiaGreen
		: thinkingLevelColorizer(theme, color, thinkingLevel);
}
