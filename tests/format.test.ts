import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkingMessage, formatTokenRate, formatTokens, TOKEN_RATE_PLACEHOLDER } from "../src/format.ts";

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

test("token rate joins the adjacent detail group", () => {
	const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` };
	const message = buildWorkingMessage(theme as never, {
		text: "Working",
		elapsed: "3s",
		tokens: "↓ 84 tokens",
		tokenRate: "<warning> 28 tps</warning>",
	});

	assert.equal(message, "Working <warning> 28 tps</warning><dim> · </dim><muted>3s</muted><dim> · </dim><muted>↓ 84 tokens</muted>");
});

test("detail styling survives a token rate moved before another detail", () => {
	const theme = {
		fg: (color: string, text: string) => `\x1b[38;5;${color === "dim" ? 8 : color === "muted" ? 6 : 7}m${text}\x1b[39m`,
	};
	const message = buildWorkingMessage(theme as never, {
		elapsed: "3s",
		tokens: "↓ 84 tokens",
		tokenRate: "\x1b[38;5;3m 28 tps\x1b[39m",
	}, ["elapsed", "tokenRate", "tokens"]);

	assert.equal(
		message,
		"\x1b[38;5;6m3s\x1b[39m\x1b[38;5;8m · \x1b[39m\x1b[38;5;3m 28 tps\x1b[39m\x1b[38;5;8m · \x1b[39m\x1b[38;5;6m↓ 84 tokens\x1b[39m",
	);
});

test("detail separators do not surround a detail element moved outside its group", () => {
	const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` };
	const message = buildWorkingMessage(theme as never, {
		text: "Working",
		elapsed: "3s",
		tokens: "↓ 84 tokens",
		tokenRate: "<warning>28 tps</warning>",
	}, ["elapsed", "text", "tokens", "tokenRate"]);

	assert.equal(message, "<muted>3s</muted> Working <muted>↓ 84 tokens</muted><dim> · </dim><warning>28 tps</warning>");
});

test("response model is a pre-colored detail and follows the default trailing separator", () => {
	const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` };
	assert.equal(
		buildWorkingMessage(theme as never, { text: "Working", tokens: "↓ 84 tokens", responseModel: "<accent>test-model</accent>" }),
		"Working <muted>↓ 84 tokens</muted><dim> · </dim><accent>test-model</accent>",
	);
	assert.equal(buildWorkingMessage(theme as never, { responseModel: "<accent>test-model</accent>" }), "<accent>test-model</accent>");
	assert.equal(
		buildWorkingMessage(theme as never, { text: "Working", responseModel: "\x1b[2m<accent>test-model</accent>\x1b[22m" }, ["responseModel", "text"]),
		"\x1b[2m<accent>test-model</accent>\x1b[22m Working",
	);
});
