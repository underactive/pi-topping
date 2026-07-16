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

export interface DecoratorSettings {
	decorations: {
		animatedSpinner: boolean;
		shimmer: boolean;
		tokenActivityMonitor: boolean;
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

function cloneDefaults(): DecoratorSettings {
	return {
		decorations: { ...DEFAULT_SETTINGS.decorations },
		features: { ...DEFAULT_SETTINGS.features },
	};
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
			decorations: { ...defaults.decorations, ...(isPlainObject(parsed.decorations) ? parsed.decorations : undefined) },
			features: { ...defaults.features, ...(isPlainObject(parsed.features) ? parsed.features : undefined) },
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
