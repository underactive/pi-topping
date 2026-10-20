import assert from "node:assert/strict";
import test from "node:test";

import {
	colorizeNvidiaGreen,
	getResponseModelColorizer,
	NVIDIA_GREEN_HEX,
} from "../src/nvidia-green.ts";

test("uses pi-topping-statusline's NVIDIA green", () => {
	assert.equal(NVIDIA_GREEN_HEX, "#84c51a");
	assert.equal(colorizeNvidiaGreen("test-model"), "\x1b[38;2;132;197;26mtest-model\x1b[39m");
});

test("Switchyard overrides the configured response-model color", () => {
	const theme = {
		fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
		getThinkingBorderColor: (level: string) => (text: string) => `<thinking-${level}>${text}</thinking-${level}>`,
	};

	assert.equal(
		getResponseModelColorizer(theme as never, "error", "high", "switchyard")("test-model"),
		"\x1b[38;2;132;197;26mtest-model\x1b[39m",
	);
	assert.equal(
		getResponseModelColorizer(theme as never, "error", "high", "anthropic")("test-model"),
		"<error>test-model</error>",
	);
});
