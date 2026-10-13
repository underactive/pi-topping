import assert from "node:assert/strict";
import test from "node:test";
import {
	applyOutputStyle,
	EXPLANATORY_FEATURE_PROMPT,
	EXPLANATORY_REMINDER,
	EXPLANATORY_SECTION,
	fromLegacyOutputStyle,
	INSIGHT_STAR,
	isOutputStyleId,
	OUTPUT_STYLE_IDS,
	OUTPUT_STYLE_MESSAGE_TYPE,
	OUTPUT_STYLE_SECTION,
	OUTPUT_STYLES,
	foldedOutputStyleSection,
	outputStyleSectionPatch,
	SIMPLIFIED_TECHNICAL_ENGLISH_REMINDER,
	SIMPLIFIED_TECHNICAL_ENGLISH_SECTION,
} from "../src/output-style.ts";

test("output style section name is valid for pi and not reserved", () => {
	assert.match(OUTPUT_STYLE_SECTION, /^[a-z][a-z0-9_-]*$/);
	assert.notEqual(OUTPUT_STYLE_SECTION, "preamble");
});

test("Explanatory prompt contains the style and both pi clarifications", () => {
	assert.ok(EXPLANATORY_SECTION.includes("# Output Style: Explanatory"));
	assert.ok(EXPLANATORY_SECTION.includes("# Explanatory Style Active"));
	assert.ok(EXPLANATORY_SECTION.includes(`${INSIGHT_STAR} Insight `));
	assert.ok(EXPLANATORY_SECTION.includes("[2-3 key educational points]"));
	assert.ok(EXPLANATORY_SECTION.includes("not in the codebase"));
	assert.ok(EXPLANATORY_SECTION.includes(
		"Respond to the user according to this Output Style, which describes how you should respond to user queries.",
	));
	assert.ok(EXPLANATORY_SECTION.includes(
		'Insight blocks are the one exception to the "Be concise in your responses" rule; keep everything outside them concise.',
	));
	assert.doesNotMatch(EXPLANATORY_SECTION, /Requesting Human Contributions/);
});

test("Explanatory prompt retains Claude Code's rule lengths", () => {
	const rules = EXPLANATORY_FEATURE_PROMPT.split("\n").filter(line => line.includes("────────────────"));
	assert.equal(rules.length, 2);
	assert.equal((rules[0]?.match(/─/g) ?? []).length, 37);
	assert.equal((rules[1]?.match(/─/g) ?? []).length, 49);
});

test("output style ids are lowercase and legacy ids map explicitly", () => {
	assert.equal(isOutputStyleId("default"), true);
	assert.equal(isOutputStyleId("explanatory"), true);
	assert.equal(isOutputStyleId("Explanatory"), false);
	assert.equal(isOutputStyleId("Learning"), false);
	assert.equal(isOutputStyleId(42), false);

	assert.equal(fromLegacyOutputStyle("Explanatory"), "explanatory");
	assert.equal(fromLegacyOutputStyle("default"), "default");
	assert.equal(fromLegacyOutputStyle("explanatory"), undefined);
	assert.equal(fromLegacyOutputStyle("Bogus"), undefined);
	assert.equal(fromLegacyOutputStyle(undefined), undefined);
});

test("every output style has a bounded description and Default has no decorations", () => {
	for (const id of OUTPUT_STYLE_IDS) {
		const style = OUTPUT_STYLES[id];
		assert.ok(style.label.length > 0, `${id} needs a label`);
		assert.ok(style.description.length > 0, `${id} needs a description`);
		assert.ok(style.description.length <= 60, `${id} description is too long: ${style.description.length}`);
	}
	assert.equal(OUTPUT_STYLES.default.prompt, undefined);
});

test("Default clears only this registry's prompt section", () => {
	const ownSection = { other: "preserved", [OUTPUT_STYLE_SECTION]: EXPLANATORY_SECTION };
	assert.equal(applyOutputStyle(ownSection, "default"), undefined);
	assert.deepEqual(ownSection, { other: "preserved" });

	const foreignSection = { [OUTPUT_STYLE_SECTION]: "owned by another extension" };
	assert.equal(applyOutputStyle(foreignSection, "default"), undefined);
	assert.deepEqual(foreignSection, { [OUTPUT_STYLE_SECTION]: "owned by another extension" });
});

test("Explanatory sets its prompt section and returns a hidden reminder", () => {
	const sections = { other: "preserved" };
	assert.deepEqual(applyOutputStyle(sections, "explanatory"), {
		message: {
			customType: OUTPUT_STYLE_MESSAGE_TYPE,
			content: EXPLANATORY_REMINDER,
			display: false,
		},
	});
	assert.deepEqual(sections, { other: "preserved", [OUTPUT_STYLE_SECTION]: EXPLANATORY_SECTION });
});

test("hosts without structured prompt sections receive no prompt or reminder", () => {
	assert.equal(applyOutputStyle(undefined, "explanatory"), undefined);
});

test("Simplified Technical English sets its prompt section and returns a hidden reminder", () => {
	const sections = { other: "preserved" };
	assert.deepEqual(applyOutputStyle(sections, "simplified"), {
		message: {
			customType: OUTPUT_STYLE_MESSAGE_TYPE,
			content: SIMPLIFIED_TECHNICAL_ENGLISH_REMINDER,
			display: false,
		},
	});
	assert.deepEqual(sections, { other: "preserved", [OUTPUT_STYLE_SECTION]: SIMPLIFIED_TECHNICAL_ENGLISH_SECTION });
});

test("output style section patch matches the transcript fold", () => {
	assert.equal(outputStyleSectionPatch(undefined, "default"), undefined);
	assert.equal(outputStyleSectionPatch(EXPLANATORY_SECTION, "explanatory"), undefined);
	assert.equal(outputStyleSectionPatch(undefined, "simplified"), SIMPLIFIED_TECHNICAL_ENGLISH_SECTION);
	assert.equal(outputStyleSectionPatch(EXPLANATORY_SECTION, "default"), null);
	assert.equal(outputStyleSectionPatch("owned by another extension", "default"), undefined);

	const folded = foldedOutputStyleSection([
		{ role: "system", sections: { [OUTPUT_STYLE_SECTION]: EXPLANATORY_SECTION } },
		{ role: "user" },
		{ role: "system", sections: { [OUTPUT_STYLE_SECTION]: null } },
	]);
	assert.equal(folded, undefined);
});
