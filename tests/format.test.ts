import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkingMessage, fadeThemeColorString, formatElapsed, formatTokenRate, formatTokens, shimmerString, StreamingWordCounter, TOKEN_RATE_FADE_SHADE_COUNT } from "../src/format.ts";

test("formatTokens uses readable thresholds", () => {
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(1_250), "1.3k");
	assert.equal(formatTokens(17_400), "17k");
	assert.equal(formatTokens(1_250_000), "1.3M");
});

test("formatTokenRate rounds to a whole number and hides zero", () => {
	assert.equal(formatTokenRate(0), "");
	assert.equal(formatTokenRate(0.49), "");
	assert.equal(formatTokenRate(0.5), "⚡1 tok/s");
	assert.equal(formatTokenRate(28.2), "⚡28 tok/s");
});

test("fadeThemeColorString uses five cosine-eased warning-to-dim shades", () => {
	const theme = {
		getFgAnsi: (color: string) => color === "warning" ? "\x1b[38;2;110;120;130m" : "\x1b[38;2;10;20;30m",
		fg: (_color: string, text: string) => text,
	};
	const shades = Array.from({ length: TOKEN_RATE_FADE_SHADE_COUNT }, (_, level) => fadeThemeColorString("⚡20 tok/s", level, theme, "warning"));

	assert.deepEqual(shades, [
		"\x1b[38;2;100;110;120m⚡20 tok/s\x1b[0m",
		"\x1b[38;2;75;85;95m⚡20 tok/s\x1b[0m",
		"\x1b[38;2;45;55;65m⚡20 tok/s\x1b[0m",
		"\x1b[38;2;20;30;40m⚡20 tok/s\x1b[0m",
		"\x1b[38;2;10;20;30m⚡20 tok/s\x1b[0m",
	]);
});

test("fadeThemeColorString blends the selected color toward dim", () => {
	const theme = {
		getFgAnsi: (color: string) => color === "success" ? "\x1b[38;2;110;120;130m" : "\x1b[38;2;10;20;30m",
		fg: (_color: string, text: string) => text,
	};

	assert.equal(
		fadeThemeColorString("⚡20 tok/s", 0, theme, "success"),
		"\x1b[38;2;100;110;120m⚡20 tok/s\x1b[0m",
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

test("token rate remains a standalone trailing loader element", () => {
	const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` };
	const message = buildWorkingMessage(theme as never, {
		text: "Working…",
		elapsed: "3s",
		tokens: "↓ 84 tokens",
		tokenRate: "<warning>⚡28 tok/s</warning>",
	});

	assert.equal(message, "Working… <dim>(3s · ↓ 84 tokens)</dim> <warning>⚡28 tok/s</warning>");
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

test("shimmer speed scales the sweep without stretching the pause between sweeps", () => {
	const theme = {
		getFgAnsi: (color: string) => color === "dim" ? "\x1b[38;2;20;30;40m" : "\x1b[38;2;120;130;140m",
		fg: (_color: string, text: string) => text,
	};
	const measure = (speed: "slow" | "normal" | "fast"): { sweepMs: number; pauseMs: number } => {
		const lit = (ms: number): boolean => [...shimmerString("test", ms, theme, "ltr", speed)
			.matchAll(/\x1b\[38;2;(\d+;\d+;\d+)m/g)].some(match => match[1] !== "20;30;40");
		const SCAN_LIMIT_MS = 10_000;
		let ms = 0;
		while (!lit(ms)) { ms++; assert.ok(ms < SCAN_LIMIT_MS, "shimmer never lit within scan limit"); }
		const start = ms;
		while (lit(ms)) { ms++; assert.ok(ms < SCAN_LIMIT_MS, "shimmer never dimmed within scan limit"); }
		const end = ms;
		while (!lit(ms)) { ms++; assert.ok(ms < SCAN_LIMIT_MS, "shimmer never re-lit within scan limit"); }
		return { sweepMs: end - start, pauseMs: ms - end };
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
