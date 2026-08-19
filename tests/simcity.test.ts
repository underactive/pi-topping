import assert from "node:assert/strict";
import test from "node:test";

import { COMBINED_WORKING_TEXTS, pickCombinedWorkingText, pickCombinedWorkingTextSelection, pickSimCityWorkingText, SIMCITY_PHRASES } from "../src/simcity.ts";
import { WORDS } from "../src/words.ts";

test("combined selections retain their matching completion source", (t) => {
	const randomValues = [0, 0.999999];
	t.mock.method(Math, "random", () => randomValues.shift() ?? 0.999999);

	assert.deepEqual(pickCombinedWorkingTextSelection(), {
		text: "Accomplishing…",
		pastTense: "Accomplished",
		isSimCity: false,
	});
	assert.deepEqual(pickCombinedWorkingTextSelection(), {
		text: "Zeroing crime network…",
		pastTense: "Zeroed",
		isSimCity: true,
	});
	assert.equal(COMBINED_WORKING_TEXTS.length, WORDS.length + SIMCITY_PHRASES.length);
});

test("SimCity entries carry their matching past-tense words", () => {
	const expected = new Map([
		["Computing optimal bin packing", "Computed"],
		["Hiding Willio Webnet mask", "Hid"],
		["Normalizing power", "Normalized"],
		["Sonically enhancing occupant-free timber", "Enhanced"],
		["Reverse engineering image consultant", "Engineered"],
	]);

	for (const [presentTense, pastTense] of expected) {
		const entry = SIMCITY_PHRASES.find((phrase) => phrase.present_tense === presentTense);
		assert.ok(entry, `expected ${presentTense} in the SimCity phrases`);
		assert.equal(entry.past_tense, pastTense);
	}
});

test("pickCombinedWorkingText formats the selected phrase", (t) => {
	t.mock.method(Math, "random", () => 0);
	assert.equal(pickCombinedWorkingText(), "Accomplishing…");
});

test("pickSimCityWorkingText selects the first phrase at the start of the range", (t) => {
	t.mock.method(Math, "random", () => 0);
	assert.equal(pickSimCityWorkingText(), "Adding hidden agendas…");
});

test("pickSimCityWorkingText selects the last phrase at the end of the range", (t) => {
	t.mock.method(Math, "random", () => 0.999999);
	assert.equal(pickSimCityWorkingText(), "Zeroing crime network…");
});

test("pickSimCityWorkingText returns a vendored phrase with one loader ellipsis", (t) => {
	t.mock.method(Math, "random", () => 0.5);
	const picked = pickSimCityWorkingText();
	const phrase = picked.slice(0, -1);

	assert.ok(SIMCITY_PHRASES.some((entry) => entry.present_tense === phrase));
	assert.equal(picked.endsWith("…"), true);
	assert.equal(phrase.endsWith("…"), false);
});
