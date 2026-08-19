import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SIMCITY_PHRASES } from "../src/simcity.ts";

test("every expected SimCity phrase pair in simcity.test.ts matches a vendored entry", () => {
	const source = readFileSync(new URL("./simcity.test.ts", import.meta.url), "utf8");
	const expectedPairs = [...source.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)];

	assert.ok(expectedPairs.length > 0, "no expected phrase pairs found in simcity.test.ts");
	for (const [, presentTense, pastTense] of expectedPairs) {
		const entry = SIMCITY_PHRASES.find((phrase) => phrase.present_tense === presentTense);
		assert.ok(entry, `expected ${presentTense} in the SimCity phrases`);
		assert.equal(entry.past_tense, pastTense);
	}
});
