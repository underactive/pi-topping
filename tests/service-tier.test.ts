import assert from "node:assert/strict";
import test from "node:test";

import {
	formatServiceTierSummary,
	recordServiceTierCall,
	sanitizeServiceTier,
	serviceTierCountsOf,
	serviceTierOf,
} from "../src/service-tier.ts";


test("sanitizeServiceTier strips controls, trims, and caps at 32 Unicode characters", () => {
	assert.equal(sanitizeServiceTier(" \u001b[31mflex\u0000 "), "[31mflex");
	assert.equal(sanitizeServiceTier("  priority  "), "priority");
	assert.equal(sanitizeServiceTier("x".repeat(40)), "x".repeat(32));
	assert.equal(sanitizeServiceTier("😀".repeat(40)), "😀".repeat(32));
	assert.equal(sanitizeServiceTier(" \u0000\u001b "), undefined);
	assert.equal(sanitizeServiceTier(7), undefined);
	assert.equal(sanitizeServiceTier(null), undefined);
});

test("serviceTierOf extracts provider-specific raw event fields in priority order", () => {
	assert.equal(serviceTierOf({ service_tier: "chat", serviceTier: "camel" }), "chat");
	assert.equal(serviceTierOf({ service_tier: "  ", serviceTier: "camel" }), "camel");
	assert.equal(serviceTierOf({ response: { service_tier: "responses" } }), "responses");
	assert.equal(serviceTierOf({ usage: { service_tier: "anthropic-delta" } }), "anthropic-delta");
	assert.equal(serviceTierOf({ message: { usage: { service_tier: "anthropic-start" } } }), "anthropic-start");
	assert.equal(serviceTierOf({ service_tier: "  ", response: { service_tier: "fallback" } }), "fallback");
});

test("serviceTierOf ignores malformed payload shapes and never throws", () => {
	for (const value of [null, undefined, 1, "flex", [], ["flex"], {}, { response: [] }, { usage: null }, { message: { usage: [] } }]) {
		assert.equal(serviceTierOf(value), undefined, JSON.stringify(value));
	}
	const throwingPayload = Object.defineProperty({}, "service_tier", {
		get() {
			throw new Error("untrusted getter");
		},
	});
	assert.doesNotThrow(() => serviceTierOf(throwingPayload));
	assert.equal(serviceTierOf(throwingPayload), undefined);
});

test("recordServiceTierCall increments counts and preserves first-seen order", () => {
	const counts: { tier: string; calls: number }[] = [];
	recordServiceTierCall(counts, "flex");
	recordServiceTierCall(counts, "priority");
	recordServiceTierCall(counts, "flex");
	assert.deepEqual(counts, [
		{ tier: "flex", calls: 2 },
		{ tier: "priority", calls: 1 },
	]);
});

test("serviceTierCountsOf validates persisted data and merges sanitized duplicates", () => {
	assert.deepEqual(serviceTierCountsOf(null), []);
	assert.deepEqual(serviceTierCountsOf({ tier: "flex", calls: 1 }), []);
	assert.deepEqual(
		serviceTierCountsOf([
			null,
			[],
			"flex",
			{ tier: "", calls: 1 },
			{ tier: "flex", calls: 0 },
			{ tier: "flex", calls: -1 },
			{ tier: "flex", calls: 1.5 },
			{ tier: "flex", calls: Number.NaN },
			{ tier: "flex", calls: Number.POSITIVE_INFINITY },
			{ tier: "flex", calls: Number.MAX_SAFE_INTEGER + 1 },
			{ tier: 12, calls: 1 },
			{ tier: " flex ", calls: 2 },
			{ tier: "\u0000flex", calls: 3 },
			{ tier: "priority", calls: 1 },
		]),
		[
			{ tier: "flex", calls: 5 },
			{ tier: "priority", calls: 1 },
		],
	);
});

test("formatServiceTierSummary handles empty, single, repeated, and mixed tiers", () => {
	assert.equal(formatServiceTierSummary([]), "");
	assert.equal(formatServiceTierSummary([{ tier: "flex", calls: 1 }]), "flex tier");
	assert.equal(formatServiceTierSummary([{ tier: "flex", calls: 3 }]), "flex tier ×3");
	assert.equal(
		formatServiceTierSummary([
			{ tier: "flex", calls: 2 },
			{ tier: "priority", calls: 1 },
		]),
		"flex tier ×2, priority tier ×1",
	);
});
