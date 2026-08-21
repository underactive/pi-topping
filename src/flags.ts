/**
 * Feature gates for unreleased functionality.
 *
 * Sibling-topping detection and the `/topping-setup` command ship dark: the
 * default below stays `false` until the flow is ready for the public. Setting
 * `PI_TOPPING_SIBLING_SETUP` to any value other than `0`, `false`, `off`, or
 * `no` (case-insensitive) opts a session in without touching code.
 */

const SIBLING_SETUP_DEFAULT = false;

const FALSEY_FLAG_VALUES = new Set(["0", "false", "off", "no"]);

/** Whether the sibling-topping setup flow is registered and advertised. */
export function isSiblingSetupEnabled(): boolean {
	const value = process.env.PI_TOPPING_SIBLING_SETUP?.trim().toLowerCase();
	if (value === undefined || value === "") return SIBLING_SETUP_DEFAULT;
	return !FALSEY_FLAG_VALUES.has(value);
}
