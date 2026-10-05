import assert from "node:assert/strict";
import test from "node:test";

import { servedModelOf } from "../src/served-model.ts";

const responseTypes = ["response.created", "response.in_progress", "response.completed", "response.incomplete"] as const;

for (const type of responseTypes) {
	test(`servedModelOf reads ${type} with and without a gateway backend`, () => {
		assert.deepEqual(servedModelOf({ type, response: { model: "moonshotai/Kimi-K3" } }), {
			model: "moonshotai/Kimi-K3",
		});
		assert.deepEqual(servedModelOf({ type, response: { model: "moonshotai/Kimi-K3" }, provider: "baseten" }), {
			model: "moonshotai/Kimi-K3",
			backend: "baseten",
		});
	});
}

test("servedModelOf sanitizes and trims both model and backend labels", () => {
	assert.deepEqual(servedModelOf({
		response: { model: " \u0000 moonshotai/Kimi-K3 \u001b " },
		provider: " \u0000 baseten \u001b ",
	}), {
		model: "moonshotai/Kimi-K3",
		backend: "baseten",
	});
});

test("servedModelOf rejects an empty model and omits an empty backend", () => {
	assert.equal(servedModelOf({ response: { model: " \u0000 " }, provider: "baseten" }), undefined);
	assert.deepEqual(servedModelOf({ response: { model: "served-model" }, provider: " \u0000 " }), {
		model: "served-model",
	});
	assert.deepEqual(servedModelOf({ response: { model: "served-model" }, provider: 7 }), {
		model: "served-model",
	});
});

test("servedModelOf ignores chat-completions, Anthropic, and malformed payload shapes", () => {
	for (const value of [
		{ model: "gpt-4.1" },
		{ message: { model: "claude-sonnet-4-5" } },
		{ response: { model: 7 } },
		{ response: [] },
		null,
		undefined,
		7,
		"payload",
		[],
		{},
	]) {
		assert.equal(servedModelOf(value), undefined);
	}
});

test("servedModelOf never throws for untrusted getters", () => {
	const throwingResponse = Object.defineProperty({}, "response", {
		get() {
			throw new Error("response getter");
		},
	});
	const throwingModel = { response: Object.defineProperty({}, "model", {
		get() {
			throw new Error("model getter");
		},
	}) };
	const throwingProvider = Object.defineProperty({ response: { model: "served-model" } }, "provider", {
		get() {
			throw new Error("provider getter");
		},
	});

	for (const value of [throwingResponse, throwingModel, throwingProvider]) {
		assert.doesNotThrow(() => servedModelOf(value));
		assert.equal(servedModelOf(value), undefined);
	}
});
