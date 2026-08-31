import assert from "node:assert/strict";
import test from "node:test";

import { modelsResemble } from "../src/util.ts";

test("modelsResemble recognizes decorated forms of the selected model", () => {
	for (const { selected, response, expected } of [
		{ selected: "qwen3-27b", response: "/models/Qwen3.8-27B-UD-IQ4_XS.gguf", expected: true },
		{ selected: "provider/qwen3-27b", response: "/models/Qwen3-27B.gguf", expected: true },
		{ selected: "Claude-Sonnet-4-5", response: "claude-sonnet-4-5-20250929", expected: true },
		{ selected: "qwen3-27b", response: "qwen3-32b", expected: false },
		{ selected: "qwen3-27b", response: "llama-3.3-27b", expected: false },
		{ selected: "auto", response: "resolved-model", expected: false },
		{ selected: "Auto", response: "RESOLVED-MODEL", expected: false },
		{ selected: "auto", response: "AUTO", expected: true },
		{ selected: undefined, response: "model", expected: false },
		{ selected: "", response: "model", expected: false },
		{ selected: "---", response: "model", expected: false },
		{ selected: "model", response: undefined, expected: false },
	] as const) {
		assert.equal(modelsResemble(selected, response), expected, `${selected} versus ${response}`);
	}
});
