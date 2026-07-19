import assert from "node:assert/strict";
import test from "node:test";

import { formatElapsed, formatTokens, shimmerString, StreamingWordCounter } from "../src/format.ts";

test("formatTokens uses readable thresholds", () => {
	assert.equal(formatTokens(999), "999");
	assert.equal(formatTokens(1_250), "1.3k");
	assert.equal(formatTokens(17_400), "17k");
	assert.equal(formatTokens(1_250_000), "1.3M");
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
