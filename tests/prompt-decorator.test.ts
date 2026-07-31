import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";
import { buildPromptBoxLines } from "../src/prompt-decorator.ts";

const theme = { fg: (_color: string, text: string) => text };

test("prompt box includes the Nerd Font icon and its submission time", () => {
	const submittedAt = new Date(2026, 6, 18, 14, 32, 5).getTime();
	const lines = buildPromptBoxLines("hello", submittedAt, 60, theme);

	assert.match(lines[0]!, //);
	assert.match(lines[0]!, /14:32:05/);
	assert.equal(lines.at(-1), `╚${"═".repeat(58)}╝`);
});

test("prompt box omits time when none was submitted", () => {
	const lines = buildPromptBoxLines("", undefined, 20, theme);

	assert.equal(lines.length, 2);
	assert.match(lines[0]!, //);
	assert.doesNotMatch(lines[0]!, /\d{2}:\d{2}:\d{2}/);
});

test("prompt box wraps long content without exceeding its width", () => {
	const width = 24;
	const lines = buildPromptBoxLines("one two three four five six seven eight nine", undefined, width, theme);

	assert.ok(lines.length > 3);
	assert.ok(lines.every((line) => visibleWidth(line) <= width));
});

test("prompt box returns no lines when the display is too narrow", () => {
	assert.deepEqual(buildPromptBoxLines("hello", undefined, 9, theme), []);
});

test("prompt box swaps its box-drawing glyphs per borderStyle", () => {
	const [rounded] = buildPromptBoxLines("", undefined, 20, theme, { showIcon: false, borderStyle: "rounded" });
	const [heavy] = buildPromptBoxLines("", undefined, 20, theme, { showIcon: false, borderStyle: "heavy" });
	const [single] = buildPromptBoxLines("", undefined, 20, theme, { showIcon: false, borderStyle: "single" });
	const [double] = buildPromptBoxLines("", undefined, 20, theme, { showIcon: false });

	assert.equal(rounded, `╭${"─".repeat(18)}╮`);
	assert.equal(heavy, `┏${"━".repeat(18)}┓`);
	assert.equal(single, `┌${"─".repeat(18)}┐`);
	assert.equal(double, `╔${"═".repeat(18)}╗`);
});
