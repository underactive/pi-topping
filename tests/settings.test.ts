import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
	applyMenuResult,
	buildMenuSections,
	fromCycleDirection,
	fromCycleSpeed,
	DEFAULT_SETTINGS,
	SETTING_COLOR_VALUES,
	type DecoratorSettings,
	LOADER_ORDER_ID,
	loadSettings,
	parseLoaderOrder,
	saveSettings,
	DONE_MARKER_BORDER_STYLE_VALUES,
	settingsPath,
} from "../src/settings.ts";
import { isWordPackEnabled, loadBundledWordPacks } from "../src/word-packs.ts";

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
		wordPacks: { ...DEFAULT_SETTINGS.wordPacks },
	};

	const sections = buildMenuSections(settings, loadBundledWordPacks());
	assert.deepEqual(sections.map(section => section.title), ["User Prompt", "“Working” Loader", "Elements Order", "Completion Marker", "Word Packs", "Options"]);
	const itemIds = sections.flatMap(section => section.items).map(item => item.id);
	assert.equal(new Set(itemIds).size, itemIds.length, "menu ids share one value namespace and must be unique");
	assert.deepEqual(itemIds, ["decorateUserPrompt", "borderStyle", "borderColor", "promptIcon", "promptTimestamp", "promptProvider", "promptModel", "animatedSpinner", "spinnerColor", "substituteDefaultMessage", "shimmer", "shimmerInverted", "shimmerDirection", "shimmerSpeed", "tokenActivityMonitor", "meterColor", "meterDirection", "meterDimmed", "elapsedTime", "outputTokens", "showTokenRate", "tokenRateColor", "tokenRateDimmed", "showResponseModel", "responseModelColor", "responseModelDimmed", "spinner", "text", "meter", "tokenRate", "elapsed", "tokens", "responseModel", "doneMarker", "doneMarkerStyle", "doneMarkerBorderStyle", "doneMarkerBorderColor", "doneMarkerIcon", "randomizeDoneMarker", "doneMarkerTokens", "doneMarkerInputs", "pack:doctor-who", "pack:firefly", "pack:hitchhikers-guide", "pack:lord-of-the-rings", "pack:matrix", "pack:portal", "pack:simcity", "pack:star-trek", "pack:star-wars", "useNerdFont"]);
	assert.equal(sections[1]!.items[0]!.value, false);
	assert.equal(isWordPackEnabled("simcity", DEFAULT_SETTINGS.wordPacks), false);
	assert.equal(sections[4]!.items.find(item => item.id === "pack:simcity")!.value, false);
	assert.equal(sections[4]!.items.find(item => item.id === "pack:star-trek")!.value, false);
	assert.equal(sections[4]!.items.find(item => item.id === "pack:star-wars")!.value, false);
	assert.equal(sections[4]!.items.find(item => item.id === "pack:doctor-who")!.value, false);
	assert.equal(sections[4]!.items.find(item => item.id === "pack:matrix")!.value, false);
	assert.equal(sections[4]!.items.find(item => item.id === "pack:lord-of-the-rings")!.value, false);
	assert.equal(sections[4]!.items.find(item => item.id === "pack:firefly")!.value, false);
	assert.equal(sections[4]!.items.find(item => item.id === "pack:hitchhikers-guide")!.value, false);
	assert.equal(sections[4]!.items.find(item => item.id === "pack:portal")!.value, false);
	assert.equal(sections[1]!.items.find(item => item.id === "showTokenRate")!.value, true);
	assert.equal(DEFAULT_SETTINGS.decorations.meterDirection, "rtl");
	assert.equal(DEFAULT_SETTINGS.decorations.shimmerInverted, false);
	assert.equal(DEFAULT_SETTINGS.decorations.doneMarkerBorderStyle, "none");
	assert.equal(DEFAULT_SETTINGS.decorations.doneMarkerBorderColor, "borderAccent");
	assert.deepEqual(sections[3]!.items.find(item => item.id === "doneMarkerBorderStyle")!.cycleValues, DONE_MARKER_BORDER_STYLE_VALUES);
	assert.deepEqual(sections[3]!.items.find(item => item.id === "doneMarkerBorderColor")!.cycleValues, SETTING_COLOR_VALUES);
	const tokenRateColor = sections[1]!.items.find(item => item.id === "tokenRateColor")!;
	assert.equal(tokenRateColor.value, "warning");
	assert.deepEqual(tokenRateColor.cycleValues, SETTING_COLOR_VALUES);
	for (const id of ["borderColor", "spinnerColor", "meterColor"]) {
		assert.deepEqual(sections.flatMap(section => section.items).find(item => item.id === id)!.cycleValues, SETTING_COLOR_VALUES);
	}
	assert.equal(sections[3]!.items[0]!.value, false);
});

test("buildMenuSections appends tokenRate to legacy five-element orders", () => {
	const sections = buildMenuSections({ ...DEFAULT_SETTINGS, loaderOrder: ["text", "tokens", "spinner", "meter", "elapsed"] }, loadBundledWordPacks());
	const reorderSection = sections.find(section => section.title === "Elements Order")!;
	assert.deepEqual(reorderSection.items.map(item => item.id), ["text", "tokens", "spinner", "meter", "elapsed", "tokenRate", "responseModel"]);
	assert.ok(reorderSection.items.every(item => item.reorderGroup === LOADER_ORDER_ID && item.value === false));
});

test("parseLoaderOrder drops junk and duplicates, then appends the missing elements", () => {
	assert.deepEqual(parseLoaderOrder("tokens,spinner"), ["tokens", "spinner", "text", "meter", "tokenRate", "elapsed", "responseModel"]);
	assert.deepEqual(parseLoaderOrder(["meter", "meter", "nope", 7]), ["meter", "spinner", "text", "tokenRate", "elapsed", "tokens", "responseModel"]);
	assert.deepEqual(parseLoaderOrder(undefined), [...DEFAULT_SETTINGS.loaderOrder]);
	assert.deepEqual(parseLoaderOrder(""), [...DEFAULT_SETTINGS.loaderOrder]);
});

test("parseLoaderOrder preserves complete saved orders after default changes", () => {
	const savedOrder = ["spinner", "text", "meter", "elapsed", "tokens", "tokenRate", "responseModel"];
	assert.deepEqual(parseLoaderOrder(savedOrder), savedOrder);
});

test("applyMenuResult adopts the reordered element list from the menu", () => {
	const updated = applyMenuResult(DEFAULT_SETTINGS, { [LOADER_ORDER_ID]: "text,meter,spinner,elapsed,tokens" });
	assert.deepEqual(updated.loaderOrder, ["text", "meter", "spinner", "elapsed", "tokens", "tokenRate", "responseModel"]);
	assert.deepEqual(DEFAULT_SETTINGS.loaderOrder, ["spinner", "text", "meter", "tokenRate", "elapsed", "tokens", "responseModel"]);
});

test("cycle values normalize labels and invalid preview inputs", () => {
	assert.equal(fromCycleDirection("Right to Left"), "rtl");
	assert.equal(fromCycleDirection("ltr"), "ltr");
	assert.equal(fromCycleDirection(undefined), "ltr");
	assert.equal(fromCycleDirection("unexpected"), "ltr");
	assert.equal(fromCycleSpeed("Fast"), "fast");
	assert.equal(fromCycleSpeed("normal"), "normal");
	assert.equal(fromCycleSpeed(undefined), "normal");
	assert.equal(fromCycleSpeed("unexpected"), "normal");
});

test("applyMenuResult clones settings and applies known partial values", () => {
	const original = structuredClone(DEFAULT_SETTINGS);
	const updated = applyMenuResult(original, {
		shimmer: false,
		"pack:simcity": true,
		meterDirection: "Right to Left",
		shimmerSpeed: "Fast",
		shimmerInverted: true,
		showResponseModel: false,
		responseModelDimmed: true,
		responseModelColor: "success",
		unknown: false,
	});

	assert.deepEqual(original, DEFAULT_SETTINGS);
	assert.equal(updated.decorations.shimmer, false);
	assert.equal(updated.wordPacks.simcity, true);
	assert.equal(updated.decorations.meterDirection, "rtl");
	assert.equal(updated.decorations.shimmerSpeed, "fast");
	assert.equal(updated.decorations.shimmerInverted, true);
	assert.equal(updated.features.responseModel, false);
	assert.equal(updated.decorations.responseModelDimmed, true);
	assert.equal(updated.decorations.responseModelColor, "success");
	assert.equal(updated.features.doneMarker, true);

	assert.equal(applyMenuResult(updated, { meterDirection: "Left to Right" }).decorations.meterDirection, "ltr");
	assert.equal(applyMenuResult(updated, { shimmerSpeed: "Slow" }).decorations.shimmerSpeed, "slow");
});

test("applyMenuResult accepts every completion marker border style", () => {
	for (const style of DONE_MARKER_BORDER_STYLE_VALUES) {
		assert.equal(applyMenuResult(DEFAULT_SETTINGS, { doneMarkerBorderStyle: style }).decorations.doneMarkerBorderStyle, style);
	}
});

test("applyMenuResult accepts every setting color for every color setting", () => {
	const colorKeys = ["borderColor", "doneMarkerBorderColor", "spinnerColor", "meterColor", "tokenRateColor", "responseModelColor"] as const;
	for (const color of SETTING_COLOR_VALUES) {
		for (const key of colorKeys) {
			assert.equal(applyMenuResult(DEFAULT_SETTINGS, { [key]: color }).decorations[key], color);
		}
	}
});

test("loadSettings returns defaults when the file is missing", () => {
	withTempAgentDir(() => {
		assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
		assert.equal(loadSettings().decorations.borderColor, "borderAccent");
	});
});

test("loadSettings deep-merges a partial nested file over defaults", () => {
	withTempAgentDir(() => {
		mkdirSync(join(settingsPath(), ".."), { recursive: true });
		writeFileSync(
			settingsPath(),
			JSON.stringify({ decorations: { animatedSpinner: false }, features: { outputTokens: false }, wordPacks: { simcity: true } }),
		);

		const loaded = loadSettings();
		assert.deepEqual(loaded, {
			decorations: { ...DEFAULT_SETTINGS.decorations, animatedSpinner: false },
			features: { ...DEFAULT_SETTINGS.features, outputTokens: false },
			wordPacks: { simcity: true },
			loaderOrder: [...DEFAULT_SETTINGS.loaderOrder],
		});
	});
});

test("loadSettings accepts allowed setting colors and rejects other theme colors", () => {
	withTempAgentDir(() => {
		mkdirSync(join(settingsPath(), ".."), { recursive: true });
		for (const key of ["borderColor", "doneMarkerBorderColor", "spinnerColor", "meterColor", "tokenRateColor", "responseModelColor"] as const) {
			writeFileSync(settingsPath(), JSON.stringify({ decorations: { [key]: "success" } }));
			assert.equal(loadSettings().decorations[key], "success");
		}

		writeFileSync(settingsPath(), JSON.stringify({ decorations: { borderColor: "muted", doneMarkerBorderColor: "muted", tokenRateColor: "muted" } }));
		assert.equal(loadSettings().decorations.borderColor, DEFAULT_SETTINGS.decorations.borderColor);
		assert.equal(loadSettings().decorations.doneMarkerBorderColor, DEFAULT_SETTINGS.decorations.doneMarkerBorderColor);
		assert.equal(loadSettings().decorations.tokenRateColor, DEFAULT_SETTINGS.decorations.tokenRateColor);

		writeFileSync(settingsPath(), JSON.stringify({ decorations: { doneMarkerBorderStyle: "heavy" } }));
		assert.equal(loadSettings().decorations.doneMarkerBorderStyle, "heavy");
		writeFileSync(settingsPath(), JSON.stringify({ decorations: { doneMarkerBorderStyle: "invalid" } }));
		assert.equal(loadSettings().decorations.doneMarkerBorderStyle, DEFAULT_SETTINGS.decorations.doneMarkerBorderStyle);
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
			features: { ...DEFAULT_SETTINGS.features, substituteDefaultMessage: false, elapsedTime: true, outputTokens: false, tokenRate: false, responseModel: false, doneMarker: true },
			wordPacks: { simcity: true, "star-trek": false, "star-wars": false },
			loaderOrder: ["meter", "elapsed", "spinner", "tokens", "text", "tokenRate", "responseModel"],
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
