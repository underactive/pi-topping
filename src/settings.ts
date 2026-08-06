import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_LOADER_ORDER, type LoaderElement } from "./format.ts";
import type { MenuSection } from "./menu.ts";

export const SETTING_COLOR_VALUES = ["accent", "border", "borderAccent", "success", "error", "warning"] as const;
export type SettingColor = (typeof SETTING_COLOR_VALUES)[number];

export function isSettingColor(value: unknown): value is SettingColor {
	return typeof value === "string" && SETTING_COLOR_VALUES.some(color => color === value);
}

export interface DecoratorSettings {
	decorations: {
		animatedSpinner: boolean;
		shimmer: boolean;
		shimmerDirection: "ltr" | "rtl";
		shimmerDirectionEnabled: boolean;
		shimmerSpeed: "slow" | "normal" | "fast";
		shimmerSpeedEnabled: boolean;
		tokenActivityMonitor: boolean;
		meterDirection: "ltr" | "rtl";
		meterDirectionEnabled: boolean;
		decorateUserPrompt: boolean;
		borderColor: SettingColor;
		borderColorEnabled: boolean;
		borderStyle: "double" | "single" | "rounded" | "heavy";
		borderStyleEnabled: boolean;
		spinnerColor: SettingColor;
		spinnerColorEnabled: boolean;
		meterColor: SettingColor;
		meterColorEnabled: boolean;
		meterDimmed: boolean;
		tokenRateColor: SettingColor;
		tokenRateDimmed: boolean;
		promptIcon: boolean;
		promptTimestamp: boolean;
		useNerdFont: boolean;
	};
	features: {
		substituteDefaultMessage: boolean;
		elapsedTime: boolean;
		outputTokens: boolean;
		tokenRate: boolean;
		doneMarker: boolean;
		doneMarkerIcon: boolean;
		randomizeDoneMarker: boolean;
		doneMarkerTokens: boolean;
		doneMarkerInputs: boolean;
	};
	loaderOrder: LoaderElement[];
}

export const DEFAULT_SETTINGS: DecoratorSettings = {
	decorations: { animatedSpinner: true, shimmer: true, shimmerDirection: "ltr", shimmerDirectionEnabled: true, shimmerSpeed: "normal", shimmerSpeedEnabled: true, tokenActivityMonitor: true, meterDirection: "rtl", meterDirectionEnabled: true, decorateUserPrompt: true, borderColor: "accent", borderColorEnabled: true, borderStyle: "double", borderStyleEnabled: true, spinnerColor: "accent", spinnerColorEnabled: true, meterColor: "accent", meterColorEnabled: true, meterDimmed: false, tokenRateColor: "warning", tokenRateDimmed: false, promptIcon: true, promptTimestamp: true, useNerdFont: true },
	features: { substituteDefaultMessage: true, elapsedTime: true, outputTokens: true, tokenRate: true, doneMarker: true, doneMarkerIcon: true, randomizeDoneMarker: true, doneMarkerTokens: true, doneMarkerInputs: true },
	loaderOrder: [...DEFAULT_LOADER_ORDER],
};

/** Menu key carrying the loader element order as a comma-joined list of element ids. */
export const LOADER_ORDER_ID = "loaderOrder";
const LOADER_ELEMENT_LABELS: Record<LoaderElement, string> = {
	spinner: "Animated spinner",
	text: "“Working” text",
	meter: "Token activity monitor",
	elapsed: "Elapsed time",
	tokens: "Output tokens",
	tokenRate: "Token rate",
};

/**
 * Normalize an element order from disk or from the menu, tolerating hand edits and
 * version skew: unknown entries and duplicates are dropped, missing elements are
 * appended in their default positions.
 */
export function parseLoaderOrder(value: unknown): LoaderElement[] {
	const entries = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
	const order: LoaderElement[] = [];
	for (const entry of entries) {
		const element = typeof entry === "string" ? entry.trim() as LoaderElement : undefined;
		if (element && DEFAULT_LOADER_ORDER.includes(element) && !order.includes(element)) order.push(element);
	}
	for (const element of DEFAULT_LOADER_ORDER) if (!order.includes(element)) order.push(element);
	return order;
}

export function settingsPath(): string { return join(getAgentDir(), "pi-topping", "settings.json"); }
function isPlainObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function mergeGroup<T extends Record<string, boolean | string>>(defaults: T, parsed: unknown): T {
	const merged = { ...defaults };
	if (!isPlainObject(parsed)) return merged;
	for (const [key, value] of Object.entries(parsed)) {
		if (!Object.hasOwn(merged, key)) continue;
		let valid: boolean | string | undefined;
		if (typeof merged[key] === "boolean" && typeof value === "boolean") valid = value;
		else if ((key === "meterDirection" || key === "shimmerDirection") && (value === "ltr" || value === "rtl")) valid = value;
		else if (key === "shimmerSpeed" && (value === "slow" || value === "normal" || value === "fast")) valid = value;
		else if (key.endsWith("Color") && isSettingColor(value)) valid = value;
		else if (key === "borderStyle" && (value === "double" || value === "single" || value === "rounded" || value === "heavy")) valid = value;
		if (valid !== undefined) (merged as Record<string, boolean | string>)[key] = valid;
	}
	return merged;
}

/** Map a persisted setting value to its menu cycle label (directions and speeds only; colors pass through). */
function toCycleValue(stored: unknown): string {
	if (stored === "ltr") return "Left to Right";
	if (stored === "rtl") return "Right to Left";
	if (stored === "slow") return "Slow";
	if (stored === "normal") return "Normal";
	if (stored === "fast") return "Fast";
	return String(stored);
}

/** Map a menu cycle label back to its persisted value. */
function fromCycleValue(value: string): string {
	if (value === "Left to Right") return "ltr";
	if (value === "Right to Left") return "rtl";
	if (value === "Slow") return "slow";
	if (value === "Normal") return "normal";
	if (value === "Fast") return "fast";
	return value;
}

/** Convert a persisted or menu direction to a safe preview direction. */
export function fromCycleDirection(value: unknown): "ltr" | "rtl" {
	const stored = typeof value === "string" ? fromCycleValue(value) : "";
	return stored === "rtl" ? "rtl" : "ltr";
}

/** Convert a persisted or menu speed to a safe preview speed. */
export function fromCycleSpeed(value: unknown): "slow" | "normal" | "fast" {
	const stored = typeof value === "string" ? fromCycleValue(value) : "";
	return stored === "slow" || stored === "fast" ? stored : "normal";
}

type MenuSectionName = "User Prompt" | "“Working” Loader" | "Completion Marker" | "Options";
type DecorationSettings = DecoratorSettings["decorations"];
type FeatureSettings = DecoratorSettings["features"];
type DecorationBooleanKey = { [Key in keyof DecorationSettings]: DecorationSettings[Key] extends boolean ? Key : never }[keyof DecorationSettings];
type MenuEntryBase = { id: string; label: string; section: MenuSectionName };
type DecorationMenuEntry = MenuEntryBase & { group: "decorations"; key: keyof DecorationSettings; cycleValues?: readonly string[]; cycleEnabledBy?: DecorationBooleanKey; cycleDisabledValue?: string };
type FeatureMenuEntry = MenuEntryBase & { group: "features"; key: keyof FeatureSettings; cycleValues?: never; cycleEnabledBy?: never; cycleDisabledValue?: never };
type MenuEntry = DecorationMenuEntry | FeatureMenuEntry;
export const MENU_ENTRIES: readonly MenuEntry[] = [
	{ id: "decorateUserPrompt", label: "High-vis prompt", section: "User Prompt", group: "decorations", key: "decorateUserPrompt" },
	{ id: "borderColor", label: "Border color", section: "User Prompt", group: "decorations", key: "borderColor", cycleValues: SETTING_COLOR_VALUES, cycleEnabledBy: "borderColorEnabled", cycleDisabledValue: "border" },
	{ id: "borderStyle", label: "Border style", section: "User Prompt", group: "decorations", key: "borderStyle", cycleValues: ["double", "single", "rounded", "heavy"], cycleEnabledBy: "borderStyleEnabled", cycleDisabledValue: "double" },
	{ id: "promptIcon", label: "Pi icon", section: "User Prompt", group: "decorations", key: "promptIcon" },
	{ id: "promptTimestamp", label: "Timestamp", section: "User Prompt", group: "decorations", key: "promptTimestamp" },
	{ id: "animatedSpinner", label: "Animated spinner", section: "“Working” Loader", group: "decorations", key: "animatedSpinner" },
	{ id: "spinnerColor", label: "Animated spinner color", section: "“Working” Loader", group: "decorations", key: "spinnerColor", cycleValues: SETTING_COLOR_VALUES, cycleEnabledBy: "spinnerColorEnabled", cycleDisabledValue: "accent" },
	{ id: "substituteDefaultMessage", label: "Randomize “Working” text", section: "“Working” Loader", group: "features", key: "substituteDefaultMessage" },
	{ id: "shimmer", label: "Text shimmer", section: "“Working” Loader", group: "decorations", key: "shimmer" },
	{ id: "shimmerDirection", label: "Text shimmer direction", section: "“Working” Loader", group: "decorations", key: "shimmerDirection", cycleValues: ["Left to Right", "Right to Left"], cycleEnabledBy: "shimmerDirectionEnabled", cycleDisabledValue: "Left to Right" },
	{ id: "shimmerSpeed", label: "Text shimmer speed", section: "“Working” Loader", group: "decorations", key: "shimmerSpeed", cycleValues: ["Slow", "Normal", "Fast"], cycleEnabledBy: "shimmerSpeedEnabled", cycleDisabledValue: "Normal" },
	{ id: "tokenActivityMonitor", label: "Token activity monitor", section: "“Working” Loader", group: "decorations", key: "tokenActivityMonitor" },
	{ id: "meterColor", label: "Token activity monitor color", section: "“Working” Loader", group: "decorations", key: "meterColor", cycleValues: SETTING_COLOR_VALUES, cycleEnabledBy: "meterColorEnabled", cycleDisabledValue: "accent" },
	{ id: "meterDirection", label: "Token activity monitor direction", section: "“Working” Loader", group: "decorations", key: "meterDirection", cycleValues: ["Left to Right", "Right to Left"], cycleEnabledBy: "meterDirectionEnabled", cycleDisabledValue: "Right to Left" },
	{ id: "meterDimmed", label: "Token activity monitor dimmed", section: "“Working” Loader", group: "decorations", key: "meterDimmed" },
	{ id: "elapsedTime", label: "Elapsed time since prompt", section: "“Working” Loader", group: "features", key: "elapsedTime" },
	{ id: "outputTokens", label: "Show output tokens", section: "“Working” Loader", group: "features", key: "outputTokens" },
	// id differs from key: the Elements Order row already owns "tokenRate" in the menu's shared value namespace.
	{ id: "showTokenRate", label: "Token rate", section: "“Working” Loader", group: "features", key: "tokenRate" },
	{ id: "tokenRateColor", label: "Token rate color", section: "“Working” Loader", group: "decorations", key: "tokenRateColor", cycleValues: SETTING_COLOR_VALUES },
	{ id: "tokenRateDimmed", label: "Token rate dimmed", section: "“Working” Loader", group: "decorations", key: "tokenRateDimmed" },
	{ id: "doneMarker", label: "Show completion marker", section: "Completion Marker", group: "features", key: "doneMarker" },
	{ id: "doneMarkerIcon", label: "Pi icon", section: "Completion Marker", group: "features", key: "doneMarkerIcon" },
	{ id: "randomizeDoneMarker", label: "Randomize “Worked” text", section: "Completion Marker", group: "features", key: "randomizeDoneMarker" },
	{ id: "doneMarkerTokens", label: "Tokens spent", section: "Completion Marker", group: "features", key: "doneMarkerTokens" },
	{ id: "doneMarkerInputs", label: "Mid-turn inputs", section: "Completion Marker", group: "features", key: "doneMarkerInputs" },
	{ id: "useNerdFont", label: "Use NerdFont icons", section: "Options", group: "decorations", key: "useNerdFont" },
];

function menuItem(entry: MenuEntry, settings: DecoratorSettings): MenuSection["items"][number] {
	const value = entry.group === "decorations" ? settings.decorations[entry.key] : settings.features[entry.key];
	const cycleEnabled = entry.group === "decorations" && entry.cycleEnabledBy
		? settings.decorations[entry.cycleEnabledBy]
		: undefined;
	return { id: entry.id, label: entry.label, cycleValues: entry.cycleValues, cycleEnabledBy: entry.cycleEnabledBy, cycleDisabledValue: entry.cycleDisabledValue, cycleEnabled, value: entry.cycleValues ? toCycleValue(value) : value };
}

function isDecorationBooleanKey(key: keyof DecorationSettings): key is DecorationBooleanKey {
	return typeof DEFAULT_SETTINGS.decorations[key] === "boolean";
}

function setDecorationCycleValue(decorations: DecorationSettings, key: keyof DecorationSettings, value: string): void {
	const stored = fromCycleValue(value);
	switch (key) {
		case "borderColor":
		case "spinnerColor":
		case "meterColor":
		case "tokenRateColor":
			if (isSettingColor(stored)) decorations[key] = stored;
			return;
		case "borderStyle":
			if (stored === "double" || stored === "single" || stored === "rounded" || stored === "heavy") decorations[key] = stored;
			return;
		case "shimmerDirection":
		case "meterDirection":
			if (stored === "ltr" || stored === "rtl") decorations[key] = stored;
			return;
		case "shimmerSpeed":
			if (stored === "slow" || stored === "normal" || stored === "fast") decorations[key] = stored;
			return;
		default:
			// Fail loudly if a MENU_ENTRIES cycle entry is added without a handler here.
			throw new Error(`Unhandled cycle setting: ${String(key)}`);
	}
}

function buildSection(title: MenuSectionName, settings: DecoratorSettings): MenuSection {
	return { title, items: MENU_ENTRIES.filter(entry => entry.section === title).map(entry => menuItem(entry, settings)) };
}

export function buildMenuSections(settings: DecoratorSettings): MenuSection[] {
	return [
		buildSection("User Prompt", settings),
		buildSection("“Working” Loader", settings),
		{ title: "Elements Order", items: parseLoaderOrder(settings.loaderOrder).map(id => ({ id, label: LOADER_ELEMENT_LABELS[id], value: false, reorderGroup: LOADER_ORDER_ID })) },
		buildSection("Completion Marker", settings),
		buildSection("Options", settings),
	];
}

export function applyMenuResult(settings: DecoratorSettings, values: Record<string, boolean | string>): DecoratorSettings {
	const next = structuredClone(settings);
	for (const entry of MENU_ENTRIES) {
		const value = values[entry.id];
		if (value === undefined) continue;
		if (entry.group === "decorations" && entry.cycleValues && typeof value === "string" && entry.cycleValues.includes(value)) {
			setDecorationCycleValue(next.decorations, entry.key, value);
			if (entry.cycleEnabledBy) next.decorations[entry.cycleEnabledBy] = values[entry.cycleEnabledBy] !== false;
		} else if (entry.group === "decorations" && typeof value === "boolean" && isDecorationBooleanKey(entry.key)) {
			next.decorations[entry.key] = value;
		} else if (entry.group === "features" && typeof value === "boolean") {
			next.features[entry.key] = value;
		}
	}
	if (typeof values[LOADER_ORDER_ID] === "string") next.loaderOrder = parseLoaderOrder(values[LOADER_ORDER_ID]);
	return next;
}

/**
 * Read settings.json, merging valid leaves over the defaults and falling back
 * to defaults on any read/parse error. When a cycle setting's enabled flag is
 * off, its stored value resets to the menu's disabled default so stale choices
 * don't resurface on re-enable.
 */
export function loadSettings(): DecoratorSettings {
	try {
		const parsed = JSON.parse(readFileSync(settingsPath(), "utf8"));
		if (!isPlainObject(parsed)) return structuredClone(DEFAULT_SETTINGS);
		const settings = { decorations: mergeGroup(DEFAULT_SETTINGS.decorations, parsed.decorations), features: mergeGroup(DEFAULT_SETTINGS.features, parsed.features), loaderOrder: parseLoaderOrder(parsed.loaderOrder) };
		for (const entry of MENU_ENTRIES) {
			if (entry.group === "decorations" && entry.cycleEnabledBy && entry.cycleDisabledValue !== undefined && !settings.decorations[entry.cycleEnabledBy]) {
				setDecorationCycleValue(settings.decorations, entry.key, entry.cycleDisabledValue);
			}
		}
		return settings;
	} catch { return structuredClone(DEFAULT_SETTINGS); }
}

export function saveSettings(settings: DecoratorSettings): void {
	const path = settingsPath();
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`, { flag: "wx" });
		renameSync(tmpPath, path);
	} catch (err) {
		try { unlinkSync(tmpPath); } catch { /* tmp file was never created */ }
		throw err;
	}
}
