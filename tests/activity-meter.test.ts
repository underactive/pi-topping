import assert from "node:assert/strict";
import test from "node:test";

import { ActivityMeter, rateToLevel, TokRateTracker } from "../activity-meter.ts";

test("rateToLevel maps token-rate boundaries", () => {
	assert.equal(rateToLevel(0), 0);
	assert.equal(rateToLevel(1), 1);
	assert.equal(rateToLevel(5), 1);
	assert.equal(rateToLevel(5.1), 2);
	assert.equal(rateToLevel(10), 2);
	assert.equal(rateToLevel(10.1), 3);
	assert.equal(rateToLevel(15), 3);
	assert.equal(rateToLevel(15.1), 4);
	assert.equal(rateToLevel(22), 4);
	assert.equal(rateToLevel(22.1), 5);
	assert.equal(rateToLevel(30), 5);
	assert.equal(rateToLevel(30.1), 6);
	assert.equal(rateToLevel(40), 6);
	assert.equal(rateToLevel(40.1), 7);
});

test("ActivityMeter renders and scrolls activity levels", () => {
	const meter = new ActivityMeter();

	assert.equal(meter.render(), "⢀⢀⢀⢀⢀⢀⢀⢀");
	for (let i = 0; i < 8; i++) meter.push(3);
	assert.equal(meter.render(), "⣤⣤⣤⣤⣤⣤⣤⣤");
	for (let i = 0; i < 8; i++) meter.push(7);
	assert.equal(meter.render(), "⣿⣿⣿⣿⣿⣿⣿⣿");

	meter.reset();
	for (let i = 0; i < 8; i++) meter.push(0);
	for (let i = 0; i < 3; i++) meter.push(4);
	assert.equal(meter.render(), "⣴⣴⣴⢀⢀⢀⢀⢀");
});

test("TokRateTracker avoids first-sample spikes and smooths subsequent samples", () => {
	const tracker = new TokRateTracker();

	assert.equal(tracker.sample(0, 0), 0);
	assert.equal(tracker.sample(3, 200), 6);
	assert.equal(tracker.sample(9, 400), 15.6);
	assert.equal(tracker.sample(20, 400), 15.6);
	// The 11 pending tokens at the duplicate timestamp are included at 600 ms:
	// 0.6 × (31 / 0.2) + 0.4 × 15.6 = 31.36.
	assert.equal(tracker.sample(0, 600), 31.36);

	tracker.reset();
	assert.equal(tracker.sample(100, 2_000), 0);
});
