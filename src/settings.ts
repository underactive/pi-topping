import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_LOADER_ORDER, type LoaderElement } from "./format.ts";
import type { MenuSection } from "./menu.ts";
import { isWordPackEnabled, isWordPackId, type WordPack } from "./word-packs.ts";
import { isPlainObject } from "./util.ts";

export const SETTING_COLOR_VALUES = ["accent", "border", "borderAccent", "success", "error", "warning"] as const;
export const LOADER_COLOR_VALUES = [...SETTING_COLOR_VALUES, "text", "muted"] as const;
export const THINKING_LEVEL_COLOR_VALUES = ["thinking-level", ...LOADER_COLOR_VALUES] as const;
export type ThinkingLevelColor = (typeof THINKING_LEVEL_COLOR_VALUES)[number];
export const THINKING_LEVEL_SETTING_COLOR_VALUES = ["thinking-level", ...SETTING_COLOR_VALUES] as const;
export type ThinkingLevelSettingColor = (typeof THINKING_LEVEL_SETTING_COLOR_VALUES)[number];
export const SPINNER_COLOR_VALUES = THINKING_LEVEL_SETTING_COLOR_VALUES;
export type SpinnerColor = ThinkingLevelSettingColor;
export const PROMPT_BORDER_COLOR_VALUES = THINKING_LEVEL_SETTING_COLOR_VALUES;
export type PromptBorderColor = ThinkingLevelSettingColor;
export const DONE_MARKER_BORDER_COLOR_VALUES = THINKING_LEVEL_SETTING_COLOR_VALUES;
export type DoneMarkerBorderColor = ThinkingLevelSettingColor;
const THINKING_LEVEL_COLOR_MIGRATION_VERSION = 2;
export const SETTINGS_SCHEMA_VERSION = 3;

export const BORDER_STYLE_VALUES = ["double", "single", "rounded", "heavy"] as const;
export type BorderStyle = (typeof BORDER_STYLE_VALUES)[number];
export const DONE_MARKER_BORDER_STYLE_VALUES = [...BORDER_STYLE_VALUES, "none"] as const;
export type DoneMarkerBorderStyle = (typeof DONE_MARKER_BORDER_STYLE_VALUES)[number];
export const DONE_MARKER_STYLE_VALUES = ["elite", "bookend"] as const;
export type DoneMarkerStyle = (typeof DONE_MARKER_STYLE_VALUES)[number];

export function isBorderStyle(value: unknown): value is BorderStyle {
	return typeof value === "string" && BORDER_STYLE_VALUES.some(style => style === value);
}

export function isDoneMarkerBorderStyle(value: unknown): value is DoneMarkerBorderStyle {
	return typeof value === "string" && DONE_MARKER_BORDER_STYLE_VALUES.some(style => style === value);
}

export function isDoneMarkerStyle(value: unknown): value is DoneMarkerStyle {
	return typeof value === "string" && DONE_MARKER_STYLE_VALUES.some(style => style === value);
}

export function isThinkingLevelColor(value: unknown): value is ThinkingLevelColor {
	return typeof value === "string" && THINKING_LEVEL_COLOR_VALUES.some(color => color === value);
}

export function isThinkingLevelSettingColor(value: unknown): value is ThinkingLevelSettingColor {
	return typeof value === "string" && THINKING_LEVEL_SETTING_COLOR_VALUES.some(color => color === value);
}

export const isSpinnerColor = isThinkingLevelSettingColor;
export const isPromptBorderColor = isThinkingLevelSettingColor;
export const isDoneMarkerBorderColor = isThinkingLevelSettingColor;

export interface DecoratorSettings {
	decorations: {
		animatedSpinner: boolean;
		shimmer: boolean;
		shimmerInverted: boolean;
		shimmerDirection: "ltr" | "rtl";
		shimmerDirectionEnabled: boolean;
		shimmerSpeed: "slow" | "normal" | "fast";
		shimmerSpeedEnabled: boolean;
		tokenActivityMonitor: boolean;
		meterDirection: "ltr" | "rtl";
		meterDirectionEnabled: boolean;
		decorateUserPrompt: boolean;
		borderColor: PromptBorderColor;
		borderColorEnabled: boolean;
		borderStyle: BorderStyle;
		borderStyleEnabled: boolean;
		doneMarkerBorderStyle: DoneMarkerBorderStyle;
		doneMarkerBorderColor: DoneMarkerBorderColor;
		doneMarkerStyle: DoneMarkerStyle;
		spinnerColor: SpinnerColor;
		spinnerColorEnabled: boolean;
		meterColor: ThinkingLevelColor;
		meterColorEnabled: boolean;
		meterDimmed: boolean;
		tokenRateColor: ThinkingLevelColor;
		tokenRateDimmed: boolean;
		responseModelColor: ThinkingLevelColor;
		responseModelDimmed: boolean;
		promptIcon: boolean;
		promptTimestamp: boolean;
		promptProvider: boolean;
		promptModel: boolean;
		useNerdFont: boolean;
	};
	features: {
		substituteDefaultMessage: boolean;
		elapsedTime: boolean;
		outputTokens: boolean;
		tokenRate: boolean;
		responseModel: boolean;
		doneMarker: boolean;
		doneMarkerIcon: boolean;
		randomizeDoneMarker: boolean;
		doneMarkerTokens: boolean;
		doneMarkerInputs: boolean;
	};
	loaderOrder: LoaderElement[];
	wordPacks: Record<string, boolean>;
}

export const DEFAULT_SETTINGS: DecoratorSettings = {
	decorations: { animatedSpinner: true, shimmer: true, shimmerInverted: false, shimmerDirection: "ltr", shimmerDirectionEnabled: true, shimmerSpeed: "normal", shimmerSpeedEnabled: true, tokenActivityMonitor: true, meterDirection: "rtl", meterDirectionEnabled: true, decorateUserPrompt: true, borderColor: "thinking-level", borderColorEnabled: true, borderStyle: "double", borderStyleEnabled: true, doneMarkerBorderStyle: "none", doneMarkerBorderColor: "thinking-level", doneMarkerStyle: "elite", spinnerColor: "thinking-level", spinnerColorEnabled: true, meterColor: "accent", meterColorEnabled: true, meterDimmed: false, tokenRateColor: "warning", tokenRateDimmed: false, responseModelColor: "accent", responseModelDimmed: false, promptIcon: true, promptTimestamp: true, promptProvider: true, promptModel: true, useNerdFont: true },
	features: { substituteDefaultMessage: true, elapsedTime: true, outputTokens: true, tokenRate: true, responseModel: true, doneMarker: true, doneMarkerIcon: true, randomizeDoneMarker: true, doneMarkerTokens: true, doneMarkerInputs: true },
	loaderOrder: [...DEFAULT_LOADER_ORDER],
	wordPacks: {},
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
	responseModel: "Response model",
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
function mergeGroup<T extends Record<string, boolean | string>>(defaults: T, parsed: unknown): T {
	const merged = { ...defaults };
	if (!isPlainObject(parsed)) return merged;
	for (const [key, value] of Object.entries(parsed)) {
		if (!Object.hasOwn(merged, key)) continue;
		let valid: boolean | string | undefined;
		if (typeof merged[key] === "boolean" && typeof value === "boolean") valid = value;
		else if ((key === "meterDirection" || key === "shimmerDirection") && (value === "ltr" || value === "rtl")) valid = value;
		else if (key === "shimmerSpeed" && (value === "slow" || value === "normal" || value === "fast")) valid = value;
		else if (key === "spinnerColor" && value === "default") valid = "thinking-level";
		else if (key === "spinnerColor" && isSpinnerColor(value)) valid = value;
		else if (key === "borderColor" && isPromptBorderColor(value)) valid = value;
		else if (key === "doneMarkerBorderColor" && value === "default") valid = "thinking-level";
		else if (key === "doneMarkerBorderColor" && isDoneMarkerBorderColor(value)) valid = value;
		else if ((key === "meterColor" || key === "tokenRateColor" || key === "responseModelColor") && isThinkingLevelColor(value)) valid = value;
		else if (key === "borderStyle" && isBorderStyle(value)) valid = value;
		else if (key === "doneMarkerBorderStyle" && isDoneMarkerBorderStyle(value)) valid = value;
		else if (key === "doneMarkerStyle" && isDoneMarkerStyle(value)) valid = value;
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
type DecorationMenuEntry = MenuEntryBase & { group: "decorations"; key: keyof DecorationSettings; cycleValues?: readonly string[]; cycleValueLabels?: Readonly<Record<string, string>>; cycleEnabledBy?: DecorationBooleanKey; cycleDisabledValue?: string };
type FeatureMenuEntry = MenuEntryBase & { group: "features"; key: keyof FeatureSettings; cycleValues?: never; cycleValueLabels?: never; cycleEnabledBy?: never; cycleDisabledValue?: never };
type MenuEntry = DecorationMenuEntry | FeatureMenuEntry;
const THINKING_LEVEL_CYCLE_LABELS = { "thinking-level": "thinkingLevel" } as const;
export const MENU_ENTRIES: readonly MenuEntry[] = [
	{ id: "decorateUserPrompt", label: "High-vis prompt", section: "User Prompt", group: "decorations", key: "decorateUserPrompt" },
	{ id: "borderStyle", label: "Border style", section: "User Prompt", group: "decorations", key: "borderStyle", cycleValues: BORDER_STYLE_VALUES, cycleEnabledBy: "borderStyleEnabled", cycleDisabledValue: "double" },
	{ id: "borderColor", label: "Border color", section: "User Prompt", group: "decorations", key: "borderColor", cycleValues: PROMPT_BORDER_COLOR_VALUES, cycleValueLabels: THINKING_LEVEL_CYCLE_LABELS, cycleEnabledBy: "borderColorEnabled", cycleDisabledValue: "thinking-level" },
	{ id: "promptIcon", label: "Pi icon", section: "User Prompt", group: "decorations", key: "promptIcon" },
	{ id: "promptTimestamp", label: "Timestamp", section: "User Prompt", group: "decorations", key: "promptTimestamp" },
	{ id: "promptProvider", label: "Provider", section: "User Prompt", group: "decorations", key: "promptProvider" },
	{ id: "promptModel", label: "Model", section: "User Prompt", group: "decorations", key: "promptModel" },
	{ id: "animatedSpinner", label: "Animated spinner", section: "“Working” Loader", group: "decorations", key: "animatedSpinner" },
	{ id: "spinnerColor", label: "Animated spinner color", section: "“Working” Loader", group: "decorations", key: "spinnerColor", cycleValues: SPINNER_COLOR_VALUES, cycleValueLabels: THINKING_LEVEL_CYCLE_LABELS, cycleEnabledBy: "spinnerColorEnabled", cycleDisabledValue: "thinking-level" },
	{ id: "substituteDefaultMessage", label: "Randomize “Working” text", section: "“Working” Loader", group: "features", key: "substituteDefaultMessage" },
	{ id: "shimmer", label: "Text shimmer", section: "“Working” Loader", group: "decorations", key: "shimmer" },
	{ id: "shimmerInverted", label: "Invert shimmer", section: "“Working” Loader", group: "decorations", key: "shimmerInverted" },
	{ id: "shimmerDirection", label: "Text shimmer direction", section: "“Working” Loader", group: "decorations", key: "shimmerDirection", cycleValues: ["Left to Right", "Right to Left"], cycleEnabledBy: "shimmerDirectionEnabled", cycleDisabledValue: "Left to Right" },
	{ id: "shimmerSpeed", label: "Text shimmer speed", section: "“Working” Loader", group: "decorations", key: "shimmerSpeed", cycleValues: ["Slow", "Normal", "Fast"], cycleEnabledBy: "shimmerSpeedEnabled", cycleDisabledValue: "Normal" },
	{ id: "tokenActivityMonitor", label: "Token activity monitor", section: "“Working” Loader", group: "decorations", key: "tokenActivityMonitor" },
	{ id: "meterColor", label: "Token activity monitor color", section: "“Working” Loader", group: "decorations", key: "meterColor", cycleValues: THINKING_LEVEL_COLOR_VALUES, cycleValueLabels: THINKING_LEVEL_CYCLE_LABELS, cycleEnabledBy: "meterColorEnabled", cycleDisabledValue: "accent" },
	{ id: "meterDirection", label: "Token activity monitor direction", section: "“Working” Loader", group: "decorations", key: "meterDirection", cycleValues: ["Left to Right", "Right to Left"], cycleEnabledBy: "meterDirectionEnabled", cycleDisabledValue: "Right to Left" },
	{ id: "meterDimmed", label: "Token activity monitor dimmed", section: "“Working” Loader", group: "decorations", key: "meterDimmed" },
	{ id: "elapsedTime", label: "Elapsed time since prompt", section: "“Working” Loader", group: "features", key: "elapsedTime" },
	{ id: "outputTokens", label: "Show output tokens", section: "“Working” Loader", group: "features", key: "outputTokens" },
	// id differs from key: the Elements Order row already owns "tokenRate" in the menu's shared value namespace.
	{ id: "showTokenRate", label: "Token rate", section: "“Working” Loader", group: "features", key: "tokenRate" },
	{ id: "tokenRateColor", label: "Token rate color", section: "“Working” Loader", group: "decorations", key: "tokenRateColor", cycleValues: THINKING_LEVEL_COLOR_VALUES, cycleValueLabels: THINKING_LEVEL_CYCLE_LABELS },
	{ id: "tokenRateDimmed", label: "Token rate dimmed", section: "“Working” Loader", group: "decorations", key: "tokenRateDimmed" },
	// id differs from key: the Elements Order row already owns "responseModel" in the menu's shared value namespace.
	{ id: "showResponseModel", label: "Response model", section: "“Working” Loader", group: "features", key: "responseModel" },
	{ id: "responseModelColor", label: "Response model color", section: "“Working” Loader", group: "decorations", key: "responseModelColor", cycleValues: THINKING_LEVEL_COLOR_VALUES, cycleValueLabels: THINKING_LEVEL_CYCLE_LABELS },
	{ id: "responseModelDimmed", label: "Response model dimmed", section: "“Working” Loader", group: "decorations", key: "responseModelDimmed" },
	{ id: "doneMarker", label: "Show completion marker", section: "Completion Marker", group: "features", key: "doneMarker" },
	{ id: "doneMarkerStyle", label: "Marker style", section: "Completion Marker", group: "decorations", key: "doneMarkerStyle", cycleValues: DONE_MARKER_STYLE_VALUES },
	{ id: "doneMarkerBorderStyle", label: "Border style", section: "Completion Marker", group: "decorations", key: "doneMarkerBorderStyle", cycleValues: DONE_MARKER_BORDER_STYLE_VALUES },
	{ id: "doneMarkerBorderColor", label: "Border color", section: "Completion Marker", group: "decorations", key: "doneMarkerBorderColor", cycleValues: DONE_MARKER_BORDER_COLOR_VALUES, cycleValueLabels: THINKING_LEVEL_CYCLE_LABELS },
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
	return { id: entry.id, label: entry.label, cycleValues: entry.cycleValues, cycleValueLabels: entry.cycleValueLabels, cycleEnabledBy: entry.cycleEnabledBy, cycleDisabledValue: entry.cycleDisabledValue, cycleEnabled, value: entry.cycleValues ? toCycleValue(value) : value };
}

function isDecorationBooleanKey(key: keyof DecorationSettings): key is DecorationBooleanKey {
	return typeof DEFAULT_SETTINGS.decorations[key] === "boolean";
}

function setDecorationCycleValue(decorations: DecorationSettings, key: keyof DecorationSettings, value: string): void {
	const stored = fromCycleValue(value);
	switch (key) {
		case "borderColor":
			if (isPromptBorderColor(stored)) decorations[key] = stored;
			return;
		case "spinnerColor":
			if (isSpinnerColor(stored)) decorations[key] = stored;
			return;
		case "meterColor":
		case "tokenRateColor":
		case "responseModelColor":
			if (isThinkingLevelColor(stored)) decorations[key] = stored;
			return;
		case "doneMarkerBorderColor":
			if (isDoneMarkerBorderColor(stored)) decorations[key] = stored;
			return;
		case "borderStyle":
			if (isBorderStyle(stored)) decorations[key] = stored;
			return;
		case "doneMarkerBorderStyle":
			if (isDoneMarkerBorderStyle(stored)) decorations[key] = stored;
			return;
		case "doneMarkerStyle":
			if (isDoneMarkerStyle(stored)) decorations[key] = stored;
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

export function buildMenuSections(settings: DecoratorSettings, bundledPacks: readonly WordPack[], userPacks: readonly WordPack[] = []): MenuSection[] {
	const packs = [...bundledPacks, ...userPacks];
	return [
		buildSection("User Prompt", settings),
		buildSection("“Working” Loader", settings),
		{ title: "Elements Order", items: parseLoaderOrder(settings.loaderOrder).map(id => ({ id, label: LOADER_ELEMENT_LABELS[id], value: false, reorderGroup: LOADER_ORDER_ID })) },
		buildSection("Completion Marker", settings),
		{ title: "Word Packs", items: packs.map((pack) => ({ id: `pack:${pack.id}`, label: pack.name, value: isWordPackEnabled(pack.id, settings.wordPacks) })) },
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
	for (const [id, value] of Object.entries(values)) {
		if (!id.startsWith("pack:") || typeof value !== "boolean") continue;
		const packId = id.slice("pack:".length);
		if (isWordPackId(packId)) next.wordPacks[packId] = value;
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
		const wordPacks: Record<string, boolean> = { ...DEFAULT_SETTINGS.wordPacks };
		if (isPlainObject(parsed.wordPacks)) {
			for (const [id, enabled] of Object.entries(parsed.wordPacks)) {
				if (isWordPackId(id) && typeof enabled === "boolean") wordPacks[id] = enabled;
			}
		}
		if (isPlainObject(parsed.features) && parsed.features.simCityWorkingText === true && !("simcity" in wordPacks)) {
			wordPacks.simcity = true;
		}
		const settings = { decorations: mergeGroup(DEFAULT_SETTINGS.decorations, parsed.decorations), features: mergeGroup(DEFAULT_SETTINGS.features, parsed.features), loaderOrder: parseLoaderOrder(parsed.loaderOrder), wordPacks };
		const schemaVersion = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1;
		if (schemaVersion < THINKING_LEVEL_COLOR_MIGRATION_VERSION) {
			settings.decorations.spinnerColor = "thinking-level";
			if (settings.decorations.borderColor === "borderAccent") settings.decorations.borderColor = "thinking-level";
		}
		if (schemaVersion < SETTINGS_SCHEMA_VERSION) {
			settings.decorations.doneMarkerBorderColor = "thinking-level";
		}
		for (const entry of MENU_ENTRIES) {
			if (entry.group === "decorations" && entry.cycleEnabledBy && entry.cycleDisabledValue !== undefined && !settings.decorations[entry.cycleEnabledBy]) {
				setDecorationCycleValue(settings.decorations, entry.key, entry.cycleDisabledValue);
			}
		}
		return settings;
	} catch { return structuredClone(DEFAULT_SETTINGS); }
}

export function atomicWriteFile(path: string, contents: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(tmpPath, contents, { flag: "wx" });
		renameSync(tmpPath, path);
	} catch (err) {
		try { unlinkSync(tmpPath); } catch { /* tmp file was never created */ }
		throw err;
	}
}

export function saveSettings(settings: DecoratorSettings): void {
	atomicWriteFile(settingsPath(), `${JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, ...settings }, null, 2)}\n`);
}
