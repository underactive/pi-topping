import assert from "node:assert/strict";
import test from "node:test";

import { hostBelow, modelsResemble, modelsSpelledAlike } from "../src/util.ts";

test("hostBelow compares release versions and treats unreadable versions as new enough", () => {
	for (const { version, minimum, expected } of [
		{ version: "1.1.0", minimum: "1.2.0", expected: true },
		{ version: "1.2.0", minimum: "1.2.0", expected: false },
		{ version: "1.2.1", minimum: "1.2.0", expected: false },
		{ version: "1.10.0", minimum: "1.2.0", expected: false },
		{ version: "0.99.1", minimum: "1.2.0", expected: true },
		{ version: "2.0.0", minimum: "1.2.0", expected: false },
		{ version: "1.2.0-beta.1", minimum: "1.2.0", expected: false },
		{ version: "0.0.0", minimum: "1.2.0", expected: true },
		{ version: "unknown", minimum: "1.2.0", expected: false },
		{ version: "1.2.0", minimum: "garbage", expected: false },
	] as const) {
		assert.equal(hostBelow(version, minimum), expected, `${version} below ${minimum}`);
	}
});

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

test("modelsSpelledAlike matches the selected id or display name written with other case and separators", () => {
	const local = { id: "qwen38-flash-next-iq2xs_local_256k", name: "Qwen3.8 Flash Next IQ2_XS (Local)" };
	const llama = { id: "llama-local", name: "Llama 3.1 (8B)" };
	for (const { selected, response, expected } of [
		{ selected: local, response: "qwen3.8-flash-next-iq2_xs", expected: true },
		{ selected: local, response: "host/Qwen3.8-Flash-Next-IQ2_XS", expected: true },
		{ selected: local, response: "qwen3-flash-next-iq2_xs", expected: false },
		{ selected: local, response: "qwen3.8-flash-next-iq3_xs", expected: false },
		{ selected: { id: local.id }, response: "qwen3.8-flash-next-iq2_xs", expected: false },
		{ selected: { id: "qwen38-flash" }, response: "Qwen3.8_Flash", expected: true },
		{ selected: llama, response: "llama-3.1-8b", expected: true },
		{ selected: llama, response: "llama-3.1-70b", expected: false },
		{ selected: { id: "---", name: "(?)" }, response: "---", expected: false },
		{ selected: local, response: undefined, expected: false },
	]) {
		assert.equal(modelsSpelledAlike(selected, response), expected, `${selected.id} versus ${response}`);
	}
});
