import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";
import { buildCompletionMarkerLine, buildPromptBoxLines } from "../src/prompt-decorator.ts";
import { DONE_MARKER_BORDER_COLOR_VALUES, PROMPT_BORDER_COLOR_VALUES } from "../src/settings.ts";

const theme = { fg: (_color: string, text: string) => text, getThinkingBorderColor: (_level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh") => (text: string) => text };

test("prompt box includes its icon, submission time, and provider/model", () => {
	const submittedAt = new Date(2026, 6, 18, 14, 32, 5).getTime();
	const provider = "anthropic";
	const model = "claude-sonnet-4-5";
	const lines = buildPromptBoxLines("hello", submittedAt, 60, theme, { provider, model });

	assert.match(lines[0]!, //);
	assert.match(lines[0]!, /14:32:05/);
	assert.equal(lines.at(-1), `╚${"═".repeat(28)} ${provider}/${model} ═╝`);
});

test("prompt box omits time when none was submitted", () => {
	const lines = buildPromptBoxLines("", undefined, 20, theme);

	assert.equal(lines.length, 2);
	assert.match(lines[0]!, //);
	assert.doesNotMatch(lines[0]!, /\d{2}:\d{2}:\d{2}/);
});

test("prompt box can show only the model", () => {
	const model = "claude-sonnet-4-5";
	const lines = buildPromptBoxLines("", undefined, 40, theme, {
		provider: "anthropic",
		model,
		showProvider: false,
	});

	assert.equal(lines.at(-1), `╚${"═".repeat(18)} ${model} ═╝`);
});

test("prompt box can show only the provider", () => {
	const provider = "anthropic";
	const lines = buildPromptBoxLines("", undefined, 40, theme, {
		provider,
		model: "claude-sonnet-4-5",
		showModel: false,
	});

	assert.equal(lines.at(-1), `╚${"═".repeat(26)} ${provider} ═╝`);
});

test("prompt box can hide both provider and model", () => {
	const lines = buildPromptBoxLines("", undefined, 20, theme, {
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		showProvider: false,
		showModel: false,
	});

	assert.equal(lines.at(-1), `╚${"═".repeat(18)}╝`);
});

test("prompt box wraps long content without exceeding its width", () => {
	const width = 24;
	const lines = buildPromptBoxLines("one two three four five six seven eight nine", undefined, width, theme, {
		provider: "provider",
		model: "very-long-model-name",
	});

	assert.ok(lines.length > 3);
	assert.match(lines.at(-1)!, /\.\.\./);
	assert.ok(lines.every((line) => visibleWidth(line) <= width));
});

test("prompt box returns no lines when the display is too narrow", () => {
	assert.deepEqual(buildPromptBoxLines("hello", undefined, 9, theme), []);
});

const taggedTheme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	getThinkingBorderColor: (level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh") => (text: string) => `<thinking-${level}>${text}</thinking-${level}>`,
};

test("prompt box styles its icon with the theme text color", () => {
	const lines = buildPromptBoxLines("ping", undefined, 80, taggedTheme);
	assert.match(lines[0]!, /<text><\/text>/);
});

test("prompt box accepts every prompt border color", () => {
	for (const color of PROMPT_BORDER_COLOR_VALUES) {
		const lines = buildPromptBoxLines("ping", undefined, 40, taggedTheme, { borderColor: color });
		assert.ok(lines[0]!.includes(color === "thinking-level" ? "<thinking-off>" : `<${color}>`));
	}
});

test("prompt box defaults to the off thinking-level border when no color is specified", () => {
	const lines = buildPromptBoxLines("ping", undefined, 40, taggedTheme);
	assert.match(lines[0]!, /^<thinking-off>/);
});

test("prompt box uses its captured thinking level for the thinking-level border", () => {
	const lines = buildPromptBoxLines("ping", undefined, 40, taggedTheme, { borderColor: "thinking-level", thinkingLevel: "high" });
	assert.match(lines[0]!, /^<thinking-high>/);
});

test("completion marker uses the selected border color", () => {
	for (const color of DONE_MARKER_BORDER_COLOR_VALUES) {
		const line = buildCompletionMarkerLine(" Mustered", 80, taggedTheme, "heavy", color);
		if (color === "default") assert.match(line, /^<thinking-off>┗━━/);
		else assert.match(line, new RegExp(`^<${color}>┗━━`));
	}
});

test("completion marker default border uses its thinking-level color", () => {
	assert.match(
		buildCompletionMarkerLine(" Mustered", 80, taggedTheme, "heavy", "default", "elite", "high"),
		/^<thinking-high>┗━━/,
	);
});

test("completion marker uses the selected border glyphs and requested trail", () => {
	const content = " Mustered for 4s (↓ 25 tokens)";
	assert.equal(
		buildCompletionMarkerLine(content, 52, theme, "heavy", "accent"),
		"┗━━  Mustered for 4s (↓ 25 tokens) ━━━━━━ ━━━━ ━━ ━",
	);
	assert.equal(
		buildCompletionMarkerLine(content, 52, theme, "double", "accent"),
		"╚══  Mustered for 4s (↓ 25 tokens) ══════ ════ ══ ═",
	);
	assert.equal(
		buildCompletionMarkerLine(content, 52, theme, "single", "accent"),
		"└──  Mustered for 4s (↓ 25 tokens) ────── ──── ── ─",
	);
	assert.equal(
		buildCompletionMarkerLine(content, 52, theme, "rounded", "accent"),
		"╰──  Mustered for 4s (↓ 25 tokens) ────── ──── ── ─",
	);
});

test("completion marker bookend style fills width and ends with the corner glyph", () => {
	const content = " Mustered for 4s (↓ 25 tokens)";
	const line = buildCompletionMarkerLine(content, 52, theme, "double", "accent", "bookend");
	assert.equal(visibleWidth(line), 52);
	assert.ok(line.endsWith("╝"));
});

test("none leaves completion marker content undecorated and narrow widths clip it", () => {
	const content = " Mustered for 4s (↓ 25 tokens)";
	assert.equal(buildCompletionMarkerLine(content, 52, theme, "none", "accent"), content);
	const clipped = buildCompletionMarkerLine(content, 10, theme, "heavy", "accent");
	assert.ok(visibleWidth(clipped) <= 10);
	assert.match(clipped, /^┗━━  M/);
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
