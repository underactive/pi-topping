import assert from "node:assert/strict";
import test from "node:test";

import { ROUTED_MODEL_CHANNEL, routedModelAnnouncement } from "../src/autorouter-feed.ts";

const ANNOUNCEMENT = {
	version: 1,
	provider: "openai-codex",
	modelId: "gpt-5.6-sol",
	model: "openai-codex/gpt-5.6-sol",
	name: "GPT-5.6 Sol",
	thinkingLevel: "high",
	reason: "user",
	cause: "jev_classifier",
	tier: "COMPLEX",
	ts: 1_790_000_000_000,
};

test("the routed-model channel name is shared with pi-topping-autorouter", () => {
	assert.equal(ROUTED_MODEL_CHANNEL, "pi-topping-autorouter:routed-model");
});

test("routedModelAnnouncement accepts a well-formed announcement", () => {
	assert.deepEqual(routedModelAnnouncement(ANNOUNCEMENT), { provider: "openai-codex", modelId: "gpt-5.6-sol", reason: "user" });
	const { tier: _tier, ...withoutTier } = ANNOUNCEMENT;
	assert.deepEqual(routedModelAnnouncement(withoutTier), { provider: "openai-codex", modelId: "gpt-5.6-sol", reason: "user" });
	for (const reason of ["user", "continuation", "retry", "direct"]) {
		assert.deepEqual(routedModelAnnouncement({ ...ANNOUNCEMENT, reason }), { provider: "openai-codex", modelId: "gpt-5.6-sol", reason });
	}
});

test("routedModelAnnouncement strips control characters and surrounding whitespace", () => {
	assert.deepEqual(
		routedModelAnnouncement({ ...ANNOUNCEMENT, provider: " openai\x1b-codex ", modelId: "\u200bgpt-5.6-sol\n", reason: "\x07user " }),
		{ provider: "openai-codex", modelId: "gpt-5.6-sol", reason: "user" },
	);
	assert.equal(routedModelAnnouncement({ ...ANNOUNCEMENT, modelId: " \x1b\n" }), undefined, "a value that is empty once sanitized is missing");
});

test("routedModelAnnouncement rejects malformed payloads", () => {
	for (const payload of [
		undefined,
		null,
		"gpt-5.6-sol",
		42,
		[ANNOUNCEMENT],
		{},
		{ ...ANNOUNCEMENT, version: 2 },
		{ ...ANNOUNCEMENT, version: "1" },
		{ ...ANNOUNCEMENT, version: undefined },
		{ ...ANNOUNCEMENT, provider: undefined },
		{ ...ANNOUNCEMENT, provider: "" },
		{ ...ANNOUNCEMENT, provider: 1 },
		{ ...ANNOUNCEMENT, modelId: undefined },
		{ ...ANNOUNCEMENT, modelId: "" },
		{ ...ANNOUNCEMENT, modelId: ["gpt-5.6-sol"] },
		{ ...ANNOUNCEMENT, reason: undefined },
		{ ...ANNOUNCEMENT, reason: "" },
		{ ...ANNOUNCEMENT, reason: 7 },
		{ ...ANNOUNCEMENT, reason: "User" },
		{ ...ANNOUNCEMENT, reason: "compaction" },
	]) {
		assert.equal(routedModelAnnouncement(payload), undefined, JSON.stringify(payload));
	}
});
