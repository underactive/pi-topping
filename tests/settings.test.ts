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
	LOADER_ORDER_ID,
	loadSettings,
	parseLoaderOrder,
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
		loaderOrder: [...DEFAULT_SETTINGS.loaderOrder],
	};

	const sections = buildMenuSections(settings);
	assert.deepEqual(sections.map(section => section.title), ["User Prompt", "“Working” Loader", "Elements Order", "Completion Marker", "Options"]);
	assert.deepEqual(sections.flatMap(section => section.items).map(item => item.id), ["decorateUserPrompt", "borderColor", "borderStyle", "promptIcon", "promptTimestamp", "animatedSpinner", "spinnerColor", "substituteDefaultMessage", "shimmer", "shimmerDirection", "shimmerSpeed", "tokenActivityMonitor", "meterColor", "meterDirection", "meterDimmed", "elapsedTime", "outputTokens", "spinner", "text", "meter", "elapsed", "tokens", "doneMarker", "doneMarkerIcon", "randomizeDoneMarker", "doneMarkerTokens", "doneMarkerInputs", "useNerdFont"]);
	assert.equal(sections[1]!.items[0]!.value, false);
	assert.equal(sections[3]!.items[0]!.value, false);
});

test("buildMenuSections lists the Elements Order rows in the persisted order", () => {
	const sections = buildMenuSections({ ...DEFAULT_SETTINGS, loaderOrder: ["text", "tokens", "spinner", "meter", "elapsed"] });
	const reorderSection = sections.find(section => section.title === "Elements Order")!;
	assert.deepEqual(reorderSection.items.map(item => item.id), ["text", "tokens", "spinner", "meter", "elapsed"]);
	assert.ok(reorderSection.items.every(item => item.reorderGroup === LOADER_ORDER_ID && item.value === false));
});

test("parseLoaderOrder drops junk and duplicates, then appends the missing elements", () => {
	assert.deepEqual(parseLoaderOrder("tokens,spinner"), ["tokens", "spinner", "text", "meter", "elapsed"]);
	assert.deepEqual(parseLoaderOrder(["meter", "meter", "nope", 7]), ["meter", "spinner", "text", "elapsed", "tokens"]);
	assert.deepEqual(parseLoaderOrder(undefined), [...DEFAULT_SETTINGS.loaderOrder]);
	assert.deepEqual(parseLoaderOrder(""), [...DEFAULT_SETTINGS.loaderOrder]);
});

test("applyMenuResult adopts the reordered element list from the menu", () => {
	const updated = applyMenuResult(DEFAULT_SETTINGS, { [LOADER_ORDER_ID]: "text,meter,spinner,elapsed,tokens" });
	assert.deepEqual(updated.loaderOrder, ["text", "meter", "spinner", "elapsed", "tokens"]);
	assert.deepEqual(DEFAULT_SETTINGS.loaderOrder, ["spinner", "text", "meter", "elapsed", "tokens"]);
});

test("applyMenuResult clones settings and applies known partial values", () => {
	const original = structuredClone(DEFAULT_SETTINGS);
	const updated = applyMenuResult(original, {
		shimmer: false,
		meterDirection: "Right to Left",
		shimmerSpeed: "Fast",
		unknown: false,
	});

	assert.deepEqual(original, DEFAULT_SETTINGS);
	assert.equal(updated.decorations.shimmer, false);
	assert.equal(updated.decorations.meterDirection, "rtl");
	assert.equal(updated.decorations.shimmerSpeed, "fast");
	assert.equal(updated.features.doneMarker, true);

	assert.equal(applyMenuResult(updated, { meterDirection: "Left to Right" }).decorations.meterDirection, "ltr");
	assert.equal(applyMenuResult(updated, { shimmerSpeed: "Slow" }).decorations.shimmerSpeed, "slow");
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
			loaderOrder: [...DEFAULT_SETTINGS.loaderOrder],
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
			loaderOrder: ["meter", "elapsed", "spinner", "tokens", "text"],
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
