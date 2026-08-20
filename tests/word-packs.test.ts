import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyMenuResult, buildMenuSections, DEFAULT_SETTINGS, loadSettings, saveSettings, settingsPath } from "../src/settings.ts";
import { isWordPackEnabled, loadBundledWordPacks, loadUserWordPacks, parseWordPacks, pickWorkingTextSelection, wordPacksPath } from "../src/word-packs.ts";
import { WORDS } from "../src/words.ts";

function withTempAgentDir<T>(fn: () => T): T {
	const dir = mkdtempSync(join(tmpdir(), "pi-topping-test-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try { return fn(); } finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
}

test("loads every modular bundled pack with matching irregular tenses", () => {
	const packs = loadBundledWordPacks();
	assert.deepEqual(packs.map((pack) => pack.id), ["simcity", "star-trek", "star-wars"]);

	const pack = packs.find((candidate) => candidate.id === "simcity");
	assert.ok(pack);
	assert.equal(pack.bundled, true);
	assert.equal(pack.words.length, 105);
	assert.deepEqual(pack.words.find((word) => word.present_tense === "Binding sapling root system"), { present_tense: "Binding sapling root system", past_tense: "Bound" });
	assert.deepEqual(pack.words.find((word) => word.present_tense === "Hiding Willio Webnet mask"), { present_tense: "Hiding Willio Webnet mask", past_tense: "Hid" });

	const starTrek = packs.find((candidate) => candidate.id === "star-trek");
	assert.ok(starTrek);
	assert.equal(starTrek.name, "Star Trek");
	assert.equal(starTrek.bundled, true);
	assert.equal(starTrek.words.length, 68);
	assert.deepEqual(starTrek.words.find((word) => word.present_tense === "Making it so"), { present_tense: "Making it so", past_tense: "Made" });
	assert.deepEqual(starTrek.words.find((word) => word.present_tense === "Taking the conn"), { present_tense: "Taking the conn", past_tense: "Took" });

	const starWars = packs.find((candidate) => candidate.id === "star-wars");
	assert.ok(starWars);
	assert.equal(starWars.name, "Star Wars");
	assert.equal(starWars.bundled, true);
	assert.equal(starWars.words.length, 68);
	assert.deepEqual(starWars.words.find((word) => word.present_tense === "Feeling the Force"), { present_tense: "Feeling the Force", past_tense: "Felt" });
	assert.deepEqual(starWars.words.find((word) => word.present_tense === "Taking the high ground"), { present_tense: "Taking the high ground", past_tense: "Took" });
});

test("parser discards invalid, duplicate, reserved, and empty custom packs", () => {
	const packs = parseWordPacks({ packs: [
		{ id: "simcity", name: "Reserved", words: [{ present_tense: "x", past_tense: "y" }] },
		{ id: "star-trek", name: "Reserved", words: [{ present_tense: "x", past_tense: "y" }] },
		{ id: "star-wars", name: "Reserved", words: [{ present_tense: "x", past_tense: "y" }] },
		{ id: "valid", name: "\u0000 Valid", words: [{ present_tense: "\u0000 Present", past_tense: " Past\n" }, { present_tense: 3, past_tense: "No" }] },
		{ id: "valid", name: "Duplicate", words: [{ present_tense: "x", past_tense: "y" }] },
		{ id: "empty", name: "Empty", words: [] },
	] });
	assert.deepEqual(packs, [{ id: "valid", name: "Valid", words: [{ present_tense: "Present", past_tense: "Past" }], bundled: false }]);
	assert.deepEqual(parseWordPacks({ nope: [] }), []);
});

test("custom packs are loaded tolerantly from the agent directory", () => withTempAgentDir(() => {
	assert.equal(loadUserWordPacks().length, 0);
	mkdirSync(join(wordPacksPath(), ".."), { recursive: true });
	writeFileSync(wordPacksPath(), JSON.stringify({ packs: [{ id: "custom", name: "Custom", words: [{ present_tense: "Making", past_tense: "Made" }] }] }));
	assert.equal(loadUserWordPacks()[0]!.id, "custom");
	writeFileSync(wordPacksPath(), "bad json");
	assert.deepEqual(loadUserWordPacks(), []);
}));

test("enablement defaults every pack off while respecting overrides", () => {
	assert.equal(isWordPackEnabled("simcity", {}), false);
	assert.equal(isWordPackEnabled("custom", {}), false);
	assert.equal(isWordPackEnabled("star-trek", {}), false);
	assert.equal(isWordPackEnabled("star-wars", {}), false);
	assert.equal(isWordPackEnabled("custom", { custom: false }), false);
	assert.equal(isWordPackEnabled("simcity", { simcity: true }), true);
});

test("selection is uniform across base and enabled pack entries and retains its tense", (t) => {
	const pack = { id: "custom", name: "Custom", words: [{ present_tense: "Making", past_tense: "Made" }], bundled: false };
	t.mock.method(Math, "random", () => 0.999999);
	assert.deepEqual(pickWorkingTextSelection({ custom: true }, [pack]), { text: "Making…", pastTense: "Made" });
	t.mock.method(Math, "random", () => 0);
	assert.deepEqual(pickWorkingTextSelection({ custom: false }, [pack]), { text: `${WORDS[0]!.present_tense}…`, pastTense: WORDS[0]!.past_tense });
});

test("menu includes custom packs and settings retain unavailable pack preferences", () => withTempAgentDir(() => {
	const custom = { id: "cooking", name: "Cooking", words: [{ present_tense: "Making", past_tense: "Made" }], bundled: false };
	const wordPackSection = buildMenuSections(DEFAULT_SETTINGS, [custom]).find((section) => section.title === "Word Packs");
	assert.deepEqual(wordPackSection?.items.map((item) => [item.id, item.value]), [["pack:simcity", false], ["pack:star-trek", false], ["pack:star-wars", false], ["pack:cooking", false]]);
	const updated = applyMenuResult(DEFAULT_SETTINGS, { "pack:cooking": false, "pack:restored": true, "pack:__proto__": true });
	assert.deepEqual(updated.wordPacks, { simcity: false, "star-trek": false, "star-wars": false, cooking: false, restored: true });
	saveSettings(updated);
	assert.deepEqual(loadSettings().wordPacks, updated.wordPacks);
	mkdirSync(join(settingsPath(), ".."), { recursive: true });
	writeFileSync(settingsPath(), JSON.stringify({ features: { simCityWorkingText: true } }));
	assert.equal(loadSettings().wordPacks.simcity, false);
}));
