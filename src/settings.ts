/**
 * settings.ts
 *
 * Persistent, per-user settings for pi-topping, stored at
 * `~/.pi/agent/pi-topping/settings.json`. All seven toggles
 * default to enabled so behavior is unchanged for users who never open
 * `/topping-settings`.
 */

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MenuSection } from "./menu.ts";

export interface DecoratorSettings {
	decorations: {
		animatedSpinner: boolean;
		shimmer: boolean;
		tokenActivityMonitor: boolean;
		meterDirection: "ltr" | "rtl";
	};
	features: {
		substituteDefaultMessage: boolean;
		elapsedTime: boolean;
		outputTokens: boolean;
		doneMarker: boolean;
	};
}

export const DEFAULT_SETTINGS: DecoratorSettings = {
	decorations: {
		animatedSpinner: true,
		shimmer: true,
		tokenActivityMonitor: true,
		meterDirection: "ltr",
	},
	features: {
		substituteDefaultMessage: true,
		elapsedTime: true,
		outputTokens: true,
		doneMarker: true,
	},
};

/** Resolve the absolute path to this extension's settings file. */
export function settingsPath(): string {
	return join(getAgentDir(), "pi-topping", "settings.json");
}

/**
 * True for plain `{}`-style objects only -- excludes `null`, arrays, and
 * primitives. Used to guard against malformed/hand-edited settings.json
 * content (e.g. `"decorations": "oops"` or `"decorations": [1,2,3]`) before
 * spreading it onto the defaults, so a wrong-shaped field can't leak stray
 * properties (like numeric-string keys from spreading a string) into the
 * merged settings object.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge persisted JSON values onto a defaults object, accepting both boolean
 * fields and a known enum-typed string field (`meterDirection`). Any unknown
 * or wrong-typed keys are silently ignored so hand-edited settings.json can't
 * corrupt the resulting shape.
 */
function mergeDecorations(
	defaults: DecoratorSettings["decorations"],
	parsed: unknown,
): DecoratorSettings["decorations"] {
	const merged = { ...defaults };
	if (!isPlainObject(parsed)) return merged;
	for (const [key, value] of Object.entries(parsed)) {
		if (key === "meterDirection") {
			if (value === "ltr" || value === "rtl") {
				merged.meterDirection = value;
			}
		} else if (typeof value === "boolean" && key in merged) {
			(merged as Record<string, unknown>)[key] = value;
		}
	}
	return merged;
}

function mergeBooleanGroup<T extends Record<string, boolean>>(defaults: T, parsed: unknown): T {
	const merged = { ...defaults } as T;
	if (!isPlainObject(parsed)) return merged;
	for (const [key, value] of Object.entries(parsed)) {
		if (typeof value === "boolean" && key in merged) {
			merged[key as keyof T] = value as T[keyof T];
		}
	}
	return merged;
}

interface DecorationBooleanMenuEntry {
	id: "animatedSpinner" | "shimmer" | "tokenActivityMonitor";
	label: string;
	section: "Decorations";
	group: "decorations";
}

interface FeatureBooleanMenuEntry {
	id: "substituteDefaultMessage" | "elapsedTime" | "outputTokens" | "doneMarker";
	label: string;
	section: "Options";
	group: "features";
}

interface DirectionMenuEntry {
	id: "meterDirection_rtl";
	label: string;
	section: "Options";
	group: "decorations";
}

type MenuEntry = DecorationBooleanMenuEntry | FeatureBooleanMenuEntry | DirectionMenuEntry;

/** The ordered settings-menu schema and its explicit settings conversions. */
export const MENU_ENTRIES: readonly MenuEntry[] = [
	{ id: "animatedSpinner", label: "Animated spinner", section: "Decorations", group: "decorations" },
	{ id: "shimmer", label: "“Working...” text shimmer", section: "Decorations", group: "decorations" },
	{ id: "tokenActivityMonitor", label: "Token activity monitor", section: "Decorations", group: "decorations" },
	{ id: "substituteDefaultMessage", label: "Substitute Pi's “Working…” message", section: "Options", group: "features" },
	{ id: "elapsedTime", label: "Elapsed time since prompt", section: "Options", group: "features" },
	{ id: "outputTokens", label: "Show output tokens", section: "Options", group: "features" },
	{ id: "doneMarker", label: "Show completion marker", section: "Options", group: "features" },
	{ id: "meterDirection_rtl", label: "Scrolling: Right → Left", section: "Options", group: "decorations" },
];

/** Build the ordered toggle-menu sections from persisted settings. */
export function buildMenuSections(settings: DecoratorSettings): MenuSection[] {
	return ["Decorations", "Options"].map((title) => ({
		title,
		items: MENU_ENTRIES.filter((entry) => entry.section === title).map((entry) => ({
			id: entry.id,
			label: entry.label,
			value:
				entry.id === "meterDirection_rtl"
					? settings.decorations.meterDirection === "rtl"
					: entry.group === "decorations"
						? settings.decorations[entry.id]
						: settings.features[entry.id],
		})),
	}));
}

/** Clone settings and apply recognized menu values, including direction conversion. */
export function applyMenuResult(
	settings: DecoratorSettings,
	values: Record<string, boolean>,
): DecoratorSettings {
	const next = structuredClone(settings);
	for (const entry of MENU_ENTRIES) {
		const value = values[entry.id];
		if (value === undefined) continue;
		if (entry.id === "meterDirection_rtl") {
			next.decorations.meterDirection = value ? "rtl" : "ltr";
		} else if (entry.group === "decorations") {
			next.decorations[entry.id] = value;
		} else {
			next.features[entry.id] = value;
		}
	}
	return next;
}

function cloneDefaults(): DecoratorSettings {
	return structuredClone(DEFAULT_SETTINGS);
}

/**
 * Load settings from disk, deep-merging any persisted values onto the
 * defaults. Returns a fresh clone of `DEFAULT_SETTINGS` if the file is
 * missing or contains malformed JSON -- this function never throws.
 */
export function loadSettings(): DecoratorSettings {
	const defaults = cloneDefaults();
	let raw: string;
	try {
		raw = readFileSync(settingsPath(), "utf8");
	} catch {
		return defaults;
	}

	try {
		const parsed = JSON.parse(raw) as Partial<DecoratorSettings> | null;
		if (!isPlainObject(parsed)) return defaults;
		return {
			decorations: mergeDecorations(defaults.decorations, parsed.decorations),
			features: mergeBooleanGroup(defaults.features, parsed.features),
		};
	} catch {
		return defaults;
	}
}

/**
 * Persist settings to disk, creating the parent directory if needed.
 * Writes to a temp file and renames it into place so a crash mid-write
 * (kill -9, OOM, disk full) can never leave `settings.json` truncated or
 * corrupt -- `renameSync` is atomic on POSIX filesystems when source and
 * destination are on the same directory/filesystem, which they always are
 * here. A stale `.tmp` file left behind by a crash is harmless: the next
 * successful `saveSettings()` call overwrites it, and `loadSettings()`
 * never reads it.
 */
export function saveSettings(settings: DecoratorSettings): void {
	const path = settingsPath();
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.tmp`;
	writeFileSync(tmpPath, `${JSON.stringify(settings, null, 2)}\n`);
	renameSync(tmpPath, path);
}
