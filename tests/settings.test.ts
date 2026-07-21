import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
	applyMenuResult,
	buildMenuSections,
	DEFAULT_SETTINGS,
	type DecoratorSettings,
	loadSettings,
	saveSettings,
	settingsPath,
} from "../src/settings.ts";

function withTempAgentDir<T>(fn: (dir: string) => T): T {
	const dir = mkdtempSync(join(tmpdir(), "pi-topping-test-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		return fn(dir);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
}

test("buildMenuSections preserves menu IDs, labels, section order, and values", () => {
	const settings: DecoratorSettings = {
		decorations: { ...DEFAULT_SETTINGS.decorations, animatedSpinner: false, shimmer: true, tokenActivityMonitor: false, meterDirection: "rtl", decorateUserPrompt: true },
		features: { ...DEFAULT_SETTINGS.features, substituteDefaultMessage: true, elapsedTime: false, outputTokens: true, doneMarker: false },
	};

	const sections = buildMenuSections(settings);
	assert.deepEqual(sections.map(section => section.title), ["User Prompt", "Working Loader Text", "Completion Marker", "Options"]);
	assert.deepEqual(sections.flatMap(section => section.items).map(item => item.id), ["decorateUserPrompt", "borderColor", "promptIcon", "promptTimestamp", "animatedSpinner", "spinnerColor", "substituteDefaultMessage", "shimmer", "shimmerDirection", "tokenActivityMonitor", "meterColor", "meterDirection", "meterDimmed", "elapsedTime", "outputTokens", "doneMarker", "doneMarkerIcon", "randomizeDoneMarker", "doneMarkerTokens", "useNerdFont"]);
	assert.equal(sections[1]!.items[0]!.value, false);
	assert.equal(sections[2]!.items[0]!.value, false);
});

test("applyMenuResult clones settings and applies known partial values", () => {
	const original = structuredClone(DEFAULT_SETTINGS);
	const updated = applyMenuResult(original, {
		shimmer: false,
		meterDirection: "Right to Left",
		unknown: false,
	});

	assert.deepEqual(original, DEFAULT_SETTINGS);
	assert.equal(updated.decorations.shimmer, false);
	assert.equal(updated.decorations.meterDirection, "rtl");
	assert.equal(updated.features.doneMarker, true);

	assert.equal(applyMenuResult(updated, { meterDirection: "Left to Right" }).decorations.meterDirection, "ltr");
});

test("loadSettings returns defaults when the file is missing", () => {
	withTempAgentDir(() => {
		assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
	});
});

test("loadSettings deep-merges a partial nested file over defaults", () => {
	withTempAgentDir(() => {
		mkdirSync(join(settingsPath(), ".."), { recursive: true });
		writeFileSync(
			settingsPath(),
			JSON.stringify({ decorations: { animatedSpinner: false }, features: { outputTokens: false } }),
		);

		const loaded = loadSettings();
		assert.deepEqual(loaded, {
			decorations: { ...DEFAULT_SETTINGS.decorations, animatedSpinner: false },
			features: { ...DEFAULT_SETTINGS.features, outputTokens: false },
		});
	});
});

test("loadSettings returns defaults on malformed JSON", () => {
	withTempAgentDir(() => {
		saveSettings(DEFAULT_SETTINGS);
		const path = settingsPath();
		writeFileSync(path, "{ not json");
		const loaded = loadSettings();
		assert.deepEqual(loaded, DEFAULT_SETTINGS);
	});
});

test("saveSettings then loadSettings round-trips the full schema", () => {
	withTempAgentDir(() => {
		const custom: DecoratorSettings = {
			decorations: { ...DEFAULT_SETTINGS.decorations, animatedSpinner: false, shimmer: false, tokenActivityMonitor: true, meterDirection: "ltr", decorateUserPrompt: false },
			features: { ...DEFAULT_SETTINGS.features, substituteDefaultMessage: false, elapsedTime: true, outputTokens: false, doneMarker: true },
		};
		saveSettings(custom);
		assert.deepEqual(loadSettings(), custom);
	});
});

test("saveSettings creates the parent directory", () => {
	withTempAgentDir((dir) => {
		const path = settingsPath();
		assert.equal(existsSync(path), false);
		saveSettings(DEFAULT_SETTINGS);
		assert.equal(existsSync(path), true);
		assert.ok(path.startsWith(join(dir, "pi-topping")));
	});
});

test("saveSettings leaves no leftover .tmp file after a successful write", () => {
	withTempAgentDir(() => {
		const path = settingsPath();
		saveSettings(DEFAULT_SETTINGS);
		assert.equal(existsSync(`${path}.tmp`), false);
		const entries = readdirSync(dirname(path));
		assert.deepEqual(entries, ["settings.json"]);
	});
});

test("loadSettings falls back to defaults for a wrong-shaped decorations/features field", () => {
	withTempAgentDir(() => {
		mkdirSync(join(settingsPath(), ".."), { recursive: true });
		writeFileSync(
			settingsPath(),
			JSON.stringify({ decorations: "oops", features: [1, 2, 3] }),
		);

		// Neither field is a plain object, so both fall back to their defaults
		// wholesale instead of spreading a string's characters or an array's
		// indices into the merged settings object.
		assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
	});
});

test("loadSettings ignores a top-level array or primitive settings file", () => {
	withTempAgentDir(() => {
		mkdirSync(join(settingsPath(), ".."), { recursive: true });
		writeFileSync(settingsPath(), JSON.stringify([1, 2, 3]));
		assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);

		writeFileSync(settingsPath(), JSON.stringify("not an object"));
		assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
	});
});

test("loadSettings is not vulnerable to prototype pollution via a __proto__ key", () => {
	withTempAgentDir(() => {
		mkdirSync(join(settingsPath(), ".."), { recursive: true });
		writeFileSync(settingsPath(), '{"decorations": {"__proto__": {"polluted": true}}}');

		loadSettings();

		assert.equal(({} as Record<string, unknown>).polluted, undefined);
		assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);
	});
});
