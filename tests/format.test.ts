import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkingMessage, fadeThemeColorString, formatElapsed, formatTokenRate, formatTokens, shimmerString, StreamingWordCounter, TOKEN_RATE_FADE_SHADE_COUNT, TOKEN_RATE_PLACEHOLDER } from "../src/format.ts";

test("formatTokens uses readable thresholds", () => {
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(1_250), "1.3k");
	assert.equal(formatTokens(17_400), "17k");
	assert.equal(formatTokens(1_250_000), "1.3M");
});

test("formatTokenRate rounds to a whole number, pads active rates, and hides zero", () => {
	assert.equal(formatTokenRate(0), "");
	assert.equal(formatTokenRate(0.49), "");
	assert.equal(formatTokenRate(0.5), "  1 tps");
	assert.equal(formatTokenRate(28.2), " 28 tps");
	assert.equal(formatTokenRate(100), "100 tps");
	assert.equal(TOKEN_RATE_PLACEHOLDER, "--- tps");
	assert.equal(formatTokenRate(100).length, TOKEN_RATE_PLACEHOLDER.length);
});

test("fadeThemeColorString uses five cosine-eased warning-to-dim shades", () => {
	const theme = {
		getFgAnsi: (color: string) => color === "warning" ? "\x1b[38;2;110;120;130m" : "\x1b[38;2;10;20;30m",
		fg: (_color: string, text: string) => text,
	};
	const shades = Array.from({ length: TOKEN_RATE_FADE_SHADE_COUNT }, (_, level) => fadeThemeColorString(" 20 tps", level, theme, "warning"));

	assert.deepEqual(shades, [
		"\x1b[38;2;100;110;120m 20 tps\x1b[0m",
		"\x1b[38;2;75;85;95m 20 tps\x1b[0m",
		"\x1b[38;2;45;55;65m 20 tps\x1b[0m",
		"\x1b[38;2;20;30;40m 20 tps\x1b[0m",
		"\x1b[38;2;10;20;30m 20 tps\x1b[0m",
	]);
});

test("fadeThemeColorString blends the selected color toward dim", () => {
	const theme = {
		getFgAnsi: (color: string) => color === "success" ? "\x1b[38;2;110;120;130m" : "\x1b[38;2;10;20;30m",
		fg: (_color: string, text: string) => text,
	};

	assert.equal(
		fadeThemeColorString(" 20 tps", 0, theme, "success"),
		"\x1b[38;2;100;110;120m 20 tps\x1b[0m",
	);
});

test("fade and shimmer fall back for non-truecolor themes", () => {
	const theme = {
		getFgAnsi: () => "\x1b[38;5;42m",
		fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	};

	assert.equal(fadeThemeColorString("rate", 0, theme, "error"), "<error>rate</error>");
	assert.equal(shimmerString("text", 0, theme), "<text>text</text>");
});

test("token rate joins the adjacent detail group", () => {
	const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` };
	const message = buildWorkingMessage(theme as never, {
		text: "Working…",
		elapsed: "3s",
		tokens: "↓ 84 tokens",
		tokenRate: "<warning> 28 tps</warning>",
	});

	assert.equal(message, "Working… <warning> 28 tps</warning><dim> · </dim><dim>3s</dim><dim> · </dim><dim>↓ 84 tokens</dim>");
});

test("detail styling survives a token rate moved before another detail", () => {
	const theme = {
		fg: (color: string, text: string) => `\x1b[38;5;${color === "dim" ? 8 : 7}m${text}\x1b[39m`,
	};
	const message = buildWorkingMessage(theme as never, {
		elapsed: "3s",
		tokens: "↓ 84 tokens",
		tokenRate: "\x1b[38;5;3m 28 tps\x1b[39m",
	}, ["elapsed", "tokenRate", "tokens"]);

	assert.equal(
		message,
		"\x1b[38;5;8m3s\x1b[39m\x1b[38;5;8m · \x1b[39m\x1b[38;5;3m 28 tps\x1b[39m\x1b[38;5;8m · \x1b[39m\x1b[38;5;8m↓ 84 tokens\x1b[39m",
	);
});

test("detail separators do not surround a detail element moved outside its group", () => {
	const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` };
	const message = buildWorkingMessage(theme as never, {
		text: "Working…",
		elapsed: "3s",
		tokens: "↓ 84 tokens",
		tokenRate: "<warning>28 tps</warning>",
	}, ["elapsed", "text", "tokens", "tokenRate"]);

	assert.equal(message, "<dim>3s</dim> Working… <dim>↓ 84 tokens</dim><dim> · </dim><warning>28 tps</warning>");
});

test("response model is a pre-colored detail and follows the default trailing separator", () => {
	const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` };
	assert.equal(
		buildWorkingMessage(theme as never, { text: "Working…", tokens: "↓ 84 tokens", responseModel: "<accent>test-model</accent>" }),
		"Working… <dim>↓ 84 tokens</dim><dim> · </dim><accent>test-model</accent>",
	);
	assert.equal(buildWorkingMessage(theme as never, { responseModel: "<accent>test-model</accent>" }), "<accent>test-model</accent>");
	assert.equal(
		buildWorkingMessage(theme as never, { text: "Working…", responseModel: "\x1b[2m<accent>test-model</accent>\x1b[22m" }, ["responseModel", "text"]),
		"\x1b[2m<accent>test-model</accent>\x1b[22m Working…",
	);
});

test("formatElapsed clamps negatives and pads seconds", () => {
	assert.equal(formatElapsed(-1), "0s");
	assert.equal(formatElapsed(286_000), "4m 46s");
});

test("formatElapsed skips leading zero units", () => {
	assert.equal(formatElapsed(0), "0s");
	assert.equal(formatElapsed(30_000), "30s");
	assert.equal(formatElapsed(59_000), "59s");
	assert.equal(formatElapsed(60_000), "1m 0s");
	assert.equal(formatElapsed(3_600_000), "1h 0s");
	assert.equal(formatElapsed(86_400_000), "1d 0s");
});

test("shimmerString interpolates a continuous dim-to-text gradient", () => {
	const theme = {
		getFgAnsi: (color: string) => color === "dim" ? "\x1b[38;2;20;30;40m" : "\x1b[38;2;120;130;140m",
		fg: (_color: string, text: string) => text,
	};
	const text = "abcdefghijklm";
	const elapsedMs = 2000 * 16 / (text.length + 20);
	const result = shimmerString(text, elapsedMs, theme);
	const colors = [...result.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map(match => match.slice(1).join(","));

	assert.equal(colors[0], "20,30,40");
	assert.equal(colors[6], "110,120,130");
	assert.ok(new Set(colors).size > 3, "expected colors between the base and highlight");
	assert.match(result, /\x1b\[1m\x1b\[38;2;110;120;130mg\x1b\[22m/);
	assert.ok(result.endsWith("\x1b[0m"));
});

test("inverted shimmer keeps the text color at rest and dims with a gradient", () => {
	const theme = {
		getFgAnsi: (color: string) => color === "dim" ? "\x1b[38;2;20;30;40m" : "\x1b[38;2;120;130;140m",
		fg: (_color: string, text: string) => text,
	};
	const text = "abcdefghijklm";
	const elapsedMs = 2000 * 16 / (text.length + 20);
	const result = shimmerString(text, elapsedMs, theme, "ltr", "normal", true);
	const colors = [...result.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map(match => match.slice(1).join(","));

	assert.equal(colors[0], "120,130,140");
	assert.equal(colors[6], "30,40,50");
	assert.ok(new Set(colors).size > 3, "expected colors between the base and dimmed band");
	assert.doesNotMatch(result, /\x1b\[1m/);
	assert.ok(result.endsWith("\x1b[0m"));
});

test("shimmer speed scales the sweep without stretching the pause between sweeps", () => {
	const theme = {
		getFgAnsi: (color: string) => color === "dim" ? "\x1b[38;2;20;30;40m" : "\x1b[38;2;120;130;140m",
		fg: (_color: string, text: string) => text,
	};
	const measure = (speed: "slow" | "normal" | "fast"): { sweepMs: number; pauseMs: number } => {
		const lit = (ms: number): boolean => [...shimmerString("test", ms, theme, "ltr", speed)
			.matchAll(/\x1b\[38;2;(\d+;\d+;\d+)m/g)].some(match => match[1] !== "20;30;40");
		const SCAN_LIMIT_MS = 10_000;
		const STEP_MS = 5;
		// Bracket each transition in coarse STEP_MS strides, then refine to 1ms within the bracket.
		const findEdge = (fromMs: number, wantLit: boolean): number => {
			let coarse = fromMs;
			while (lit(coarse) !== wantLit) { coarse += STEP_MS; assert.ok(coarse < SCAN_LIMIT_MS, "shimmer transition not found within scan limit"); }
			let fine = Math.max(fromMs, coarse - STEP_MS + 1);
			while (lit(fine) !== wantLit) fine++;
			return fine;
		};
		const start = findEdge(0, true);
		const end = findEdge(start, false);
		const next = findEdge(end, true);
		return { sweepMs: end - start, pauseMs: next - end };
	};

	const slow = measure("slow"), normal = measure("normal"), fast = measure("fast");

	assert.ok(Math.abs(slow.sweepMs - normal.sweepMs * 2) <= 2, `slow sweep ${slow.sweepMs} should double ${normal.sweepMs}`);
	assert.ok(Math.abs(fast.sweepMs - normal.sweepMs / 2) <= 2, `fast sweep ${fast.sweepMs} should halve ${normal.sweepMs}`);

	// Scaling the whole cycle instead of just the sweep would spread these by well over a
	// second. The ~80ms that remains is the fade tail, where the band already overlaps the
	// text but is still faint enough to round to the base color, so it reads as pause.
	assert.ok(Math.abs(slow.pauseMs - fast.pauseMs) < 100, `pause drifted: ${slow.pauseMs} vs ${normal.pauseMs} vs ${fast.pauseMs}`);
	assert.ok(Math.abs(normal.pauseMs - fast.pauseMs) < 100, `pause drifted: ${slow.pauseMs} vs ${normal.pauseMs} vs ${fast.pauseMs}`);
});

test("StreamingWordCounter counts words split across deltas once", () => {
	const counter = new StreamingWordCounter();

	assert.equal(counter.count("hel"), 1);
	assert.equal(counter.count("lo world"), 1);
	assert.equal(counter.count(" again"), 1);
});

test("StreamingWordCounter separates thinking and text streams", () => {
	const counter = new StreamingWordCounter();

	assert.equal(counter.count("thought", "thinking_delta"), 1);
	assert.equal(counter.count("answer", "text_delta"), 1);
});

test("StreamingWordCounter preserves in-word state across interleaved streams", () => {
	const counter = new StreamingWordCounter();

	assert.equal(counter.count("hel", "thinking_delta"), 1);
	assert.equal(counter.count("answer", "text_delta"), 1);
	assert.equal(counter.count("lo", "thinking_delta"), 0);
});

test("StreamingWordCounter reset starts a new stream", () => {
	const counter = new StreamingWordCounter();

	assert.equal(counter.count("partial"), 1);
	counter.reset();
	assert.equal(counter.count("continuation"), 1);
});
