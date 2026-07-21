import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MenuSection } from "./menu.ts";

export interface DecoratorSettings {
	decorations: {
		animatedSpinner: boolean;
		shimmer: boolean;
		shimmerDirection: "ltr" | "rtl";
		shimmerDirectionEnabled: boolean;
		tokenActivityMonitor: boolean;
		meterDirection: "ltr" | "rtl";
		meterDirectionEnabled: boolean;
		decorateUserPrompt: boolean;
		borderColor: "accent" | "border" | "borderAccent";
		borderColorEnabled: boolean;
		spinnerColor: "accent" | "border" | "borderAccent";
		spinnerColorEnabled: boolean;
		meterColor: "accent" | "border" | "borderAccent";
		meterColorEnabled: boolean;
		meterDimmed: boolean;
		promptIcon: boolean;
		promptTimestamp: boolean;
		useNerdFont: boolean;
	};
	features: {
		substituteDefaultMessage: boolean;
		elapsedTime: boolean;
		outputTokens: boolean;
		doneMarker: boolean;
		doneMarkerIcon: boolean;
		randomizeDoneMarker: boolean;
		doneMarkerTokens: boolean;
	};
}

export const DEFAULT_SETTINGS: DecoratorSettings = {
	decorations: { animatedSpinner: true, shimmer: true, shimmerDirection: "ltr", shimmerDirectionEnabled: true, tokenActivityMonitor: true, meterDirection: "ltr", meterDirectionEnabled: true, decorateUserPrompt: true, borderColor: "accent", borderColorEnabled: true, spinnerColor: "accent", spinnerColorEnabled: true, meterColor: "accent", meterColorEnabled: true, meterDimmed: false, promptIcon: true, promptTimestamp: true, useNerdFont: true },
	features: { substituteDefaultMessage: true, elapsedTime: true, outputTokens: true, doneMarker: true, doneMarkerIcon: true, randomizeDoneMarker: true, doneMarkerTokens: true },
};

export function settingsPath(): string { return join(getAgentDir(), "pi-topping", "settings.json"); }
function isPlainObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function mergeGroup<T extends Record<string, boolean | string>>(defaults: T, parsed: unknown): T {
	const merged = { ...defaults };
	if (!isPlainObject(parsed)) return merged;
	for (const [key, value] of Object.entries(parsed)) {
		if (!(key in merged)) continue;
		if (typeof merged[key] === "boolean" && typeof value === "boolean") (merged as Record<string, boolean | string>)[key] = value;
		if ((key === "meterDirection" || key === "shimmerDirection") && (value === "ltr" || value === "rtl")) (merged as Record<string, boolean | string>)[key] = value;
		if (key.endsWith("Color") && (value === "accent" || value === "border" || value === "borderAccent")) (merged as Record<string, boolean | string>)[key] = value;
	}
	return merged;
}

/** Map a persisted setting value to its menu cycle label (directions only; colors pass through). */
function toCycleValue(stored: unknown): string {
	if (stored === "ltr") return "Left to Right";
	if (stored === "rtl") return "Right to Left";
	return String(stored);
}

/** Map a menu cycle label back to its persisted value. */
function fromCycleValue(value: string): string {
	if (value === "Left to Right") return "ltr";
	if (value === "Right to Left") return "rtl";
	return value;
}

type MenuSectionName = "User Prompt" | "Working Loader Text" | "Completion Marker" | "Options";
type DecorationSettings = DecoratorSettings["decorations"];
type FeatureSettings = DecoratorSettings["features"];
type DecorationBooleanKey = { [Key in keyof DecorationSettings]: DecorationSettings[Key] extends boolean ? Key : never }[keyof DecorationSettings];
type MenuEntryBase = { id: string; label: string; section: MenuSectionName };
type DecorationMenuEntry = MenuEntryBase & { group: "decorations"; key: keyof DecorationSettings; cycleValues?: readonly string[]; cycleEnabledBy?: DecorationBooleanKey; cycleDisabledValue?: string };
type FeatureMenuEntry = MenuEntryBase & { group: "features"; key: keyof FeatureSettings; cycleValues?: never; cycleEnabledBy?: never; cycleDisabledValue?: never };
type MenuEntry = DecorationMenuEntry | FeatureMenuEntry;
export const MENU_ENTRIES: readonly MenuEntry[] = [
	{ id: "decorateUserPrompt", label: "High-vis prompt", section: "User Prompt", group: "decorations", key: "decorateUserPrompt" },
	{ id: "borderColor", label: "Border color", section: "User Prompt", group: "decorations", key: "borderColor", cycleValues: ["accent", "border", "borderAccent"], cycleEnabledBy: "borderColorEnabled", cycleDisabledValue: "border" },
	{ id: "promptIcon", label: "Pi icon", section: "User Prompt", group: "decorations", key: "promptIcon" },
	{ id: "promptTimestamp", label: "Timestamp", section: "User Prompt", group: "decorations", key: "promptTimestamp" },
	{ id: "animatedSpinner", label: "Animated spinner", section: "Working Loader Text", group: "decorations", key: "animatedSpinner" },
	{ id: "spinnerColor", label: "Animated spinner color", section: "Working Loader Text", group: "decorations", key: "spinnerColor", cycleValues: ["accent", "border", "borderAccent"], cycleEnabledBy: "spinnerColorEnabled", cycleDisabledValue: "accent" },
	{ id: "substituteDefaultMessage", label: "Randomize “Working” text", section: "Working Loader Text", group: "features", key: "substituteDefaultMessage" },
	{ id: "shimmer", label: "Text shimmer", section: "Working Loader Text", group: "decorations", key: "shimmer" },
	{ id: "shimmerDirection", label: "Text shimmer direction", section: "Working Loader Text", group: "decorations", key: "shimmerDirection", cycleValues: ["Left to Right", "Right to Left"], cycleEnabledBy: "shimmerDirectionEnabled", cycleDisabledValue: "Left to Right" },
	{ id: "tokenActivityMonitor", label: "Token activity monitor", section: "Working Loader Text", group: "decorations", key: "tokenActivityMonitor" },
	{ id: "meterColor", label: "Token activity monitor color", section: "Working Loader Text", group: "decorations", key: "meterColor", cycleValues: ["accent", "border", "borderAccent"], cycleEnabledBy: "meterColorEnabled", cycleDisabledValue: "accent" },
	{ id: "meterDirection", label: "Token activity monitor direction", section: "Working Loader Text", group: "decorations", key: "meterDirection", cycleValues: ["Left to Right", "Right to Left"], cycleEnabledBy: "meterDirectionEnabled", cycleDisabledValue: "Left to Right" },
	{ id: "meterDimmed", label: "Token activity monitor dimmed", section: "Working Loader Text", group: "decorations", key: "meterDimmed" },
	{ id: "elapsedTime", label: "Elapsed time since prompt", section: "Working Loader Text", group: "features", key: "elapsedTime" },
	{ id: "outputTokens", label: "Show output tokens", section: "Working Loader Text", group: "features", key: "outputTokens" },
	{ id: "doneMarker", label: "Show completion marker", section: "Completion Marker", group: "features", key: "doneMarker" },
	{ id: "doneMarkerIcon", label: "Pi icon", section: "Completion Marker", group: "features", key: "doneMarkerIcon" },
	{ id: "randomizeDoneMarker", label: "Randomize “Worked” text", section: "Completion Marker", group: "features", key: "randomizeDoneMarker" },
	{ id: "doneMarkerTokens", label: "Tokens spent", section: "Completion Marker", group: "features", key: "doneMarkerTokens" },
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
			if (stored === "accent" || stored === "border" || stored === "borderAccent") decorations[key] = stored;
			return;
		case "shimmerDirection":
		case "meterDirection":
			if (stored === "ltr" || stored === "rtl") decorations[key] = stored;
			return;
		default:
			// Fail loudly if a MENU_ENTRIES cycle entry is added without a handler here.
			throw new Error(`Unhandled cycle setting: ${String(key)}`);
	}
}

export function buildMenuSections(settings: DecoratorSettings): MenuSection[] {
	return ["User Prompt", "Working Loader Text", "Completion Marker", "Options"].map(title => ({ title, items: MENU_ENTRIES.filter(entry => entry.section === title).map(entry => menuItem(entry, settings)) }));
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
	return next;
}

export function loadSettings(): DecoratorSettings {
	try {
		const parsed = JSON.parse(readFileSync(settingsPath(), "utf8"));
		if (!isPlainObject(parsed)) return structuredClone(DEFAULT_SETTINGS);
		const settings = { decorations: mergeGroup(DEFAULT_SETTINGS.decorations, parsed.decorations), features: mergeGroup(DEFAULT_SETTINGS.features, parsed.features) };
		const gated: readonly (readonly ["borderColor" | "spinnerColor" | "meterColor" | "shimmerDirection" | "meterDirection", "borderColorEnabled" | "spinnerColorEnabled" | "meterColorEnabled" | "shimmerDirectionEnabled" | "meterDirectionEnabled", string])[] = [
			["borderColor", "borderColorEnabled", "border"],
			["spinnerColor", "spinnerColorEnabled", "accent"],
			["meterColor", "meterColorEnabled", "accent"],
			["shimmerDirection", "shimmerDirectionEnabled", "ltr"],
			["meterDirection", "meterDirectionEnabled", "ltr"],
		];
		for (const [key, enabledKey, resetValue] of gated) {
			if (!settings.decorations[enabledKey]) (settings.decorations as unknown as Record<string, string>)[key] = resetValue;
		}
		return settings;
	} catch { return structuredClone(DEFAULT_SETTINGS); }
}
export function saveSettings(settings: DecoratorSettings): void {
	const path = settingsPath(); mkdirSync(dirname(path), { recursive: true });
	writeFileSync(`${path}.tmp`, `${JSON.stringify(settings, null, 2)}\n`); renameSync(`${path}.tmp`, path);
}
