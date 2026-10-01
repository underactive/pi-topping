import assert from "node:assert/strict";
import test from "node:test";

import { ActivityMeter, DEFAULT_METER_UPPER_BOUND_TPS, rateToLevel, TokRateTracker } from "../src/activity-meter.ts";

test("rateToLevel keeps the legacy token-rate boundaries at a 40 tps bound", () => {
	assert.equal(rateToLevel(0, 40), 0);
	assert.equal(rateToLevel(1, 40), 1);
	assert.equal(rateToLevel(5, 40), 1);
	assert.equal(rateToLevel(5.1, 40), 2);
	assert.equal(rateToLevel(10, 40), 2);
	assert.equal(rateToLevel(10.1, 40), 3);
	assert.equal(rateToLevel(15, 40), 3);
	assert.equal(rateToLevel(15.1, 40), 4);
	assert.equal(rateToLevel(22, 40), 4);
	assert.equal(rateToLevel(22.1, 40), 5);
	assert.equal(rateToLevel(30, 40), 5);
	assert.equal(rateToLevel(30.1, 40), 6);
	// Full scale is inclusive, so exactly 40 tps is now full rather than PEAK_3.
	assert.equal(rateToLevel(39.9, 40), 6);
	assert.equal(rateToLevel(40, 40), 7);
	assert.equal(rateToLevel(40.1, 40), 7);
});

test("rateToLevel scales its boundaries to the default 80 tps bound", () => {
	assert.equal(DEFAULT_METER_UPPER_BOUND_TPS, 80);
	for (const [rate, level] of [
		[0, 0], [10, 1], [10.1, 2], [20, 2], [20.1, 3], [30, 3], [30.1, 4],
		[44, 4], [44.1, 5], [60, 5], [60.1, 6], [79.9, 6], [80, 7],
	] as const) {
		assert.equal(rateToLevel(rate), level, `${rate} tps`);
	}
});

test("rateToLevel honors the minimum and maximum bounds", () => {
	assert.equal(rateToLevel(10, 10), 7);
	assert.equal(rateToLevel(9.9, 10), 6);
	assert.equal(rateToLevel(1_000, 1_000), 7);
	assert.equal(rateToLevel(999, 1_000), 6);
	assert.equal(rateToLevel(750, 1_000), 5);
});

test("rateToLevel clamps at or above the bound and treats invalid rates as idle", () => {
	for (const bound of [10, 80, 1_000]) {
		for (const rate of [bound, bound * 1.5, 1e9, Infinity]) {
			assert.equal(rateToLevel(rate, bound), 7, `${rate} tps at bound ${bound}`);
		}
		assert.equal(rateToLevel(NaN, bound), 0);
		assert.equal(rateToLevel(-1, bound), 0);
	}
});

test("rateToLevel never decreases as the rate rises and stays below full under the bound", () => {
	for (const bound of [10, 80, 1_000]) {
		let previous = 0;
		for (let rate = 0; rate <= bound * 2; rate += 0.5) {
			const level = rateToLevel(rate, bound);
			assert.ok(level >= previous, `${rate} tps at bound ${bound} dropped from ${previous} to ${level}`);
			assert.ok(level >= 0 && level <= 7);
			if (rate < bound) assert.ok(level < 7, `${rate} tps at bound ${bound} is full below the bound`);
			previous = level;
		}
	}
});

test("ActivityMeter renders clamped rates as full columns", () => {
	const meter = new ActivityMeter();
	for (let i = 0; i < 8; i++) meter.push(rateToLevel(5_000, 10));
	assert.equal(meter.render(), "⣿⣿⣿⣿⣿⣿⣿⣿");
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

test("colorizeCell dims idle cells and uses the chosen color for active cells", () => {
	const theme = { fg: (color: string, text: string) => `<${color}>${text}</${color}>` };
	const color = (name: string) => (text: string) => theme.fg(name, text);
	assert.equal(ActivityMeter.colorizeCell(0, "⢀", theme as never, color("accent")), "<dim>⢀</dim>");
	assert.equal(ActivityMeter.colorizeCell(3, "⣤", theme as never, color("accent")), "<accent>⣤</accent>");
	assert.equal(ActivityMeter.colorizeCell(3, "⣤", theme as never, color("border")), "<border>⣤</border>");
	assert.equal(ActivityMeter.colorizeCell(7, "⣿", theme as never, color("borderAccent")), "<borderAccent>⣿</borderAccent>");
	assert.equal(ActivityMeter.colorizeCell(3, "⣤", theme as never, color("success")), "<success>⣤</success>");
	assert.equal(ActivityMeter.colorizeCell(3, "⣤", theme as never, color("error")), "<error>⣤</error>");
	assert.equal(ActivityMeter.colorizeCell(3, "⣤", theme as never, color("warning")), "<warning>⣤</warning>");
	assert.equal(ActivityMeter.colorizeCell(3, "⣤", theme as never, color("accent"), true), "\x1b[2m<accent>⣤</accent>\x1b[22m");
});

test("TokRateTracker exposes the latest EMA rate and resets it", () => {
	const tracker = new TokRateTracker();
	const readOnly: { readonly tokenRate: number } = tracker;

	assert.equal(readOnly.tokenRate, 0);
	assert.equal(tracker.sample(0, 0), 0);
	assert.equal(tracker.sample(3, 200), 6);
	assert.equal(readOnly.tokenRate, 6);
	assert.equal(tracker.sample(9, 400), 15.6);
	assert.equal(tracker.sample(20, 400), 15.6);
	// The 11 pending tokens at the duplicate timestamp are included at 600 ms:
	// 0.6 × (31 / 0.2) + 0.4 × 15.6 = 31.36.
	assert.equal(tracker.sample(0, 600), 31.36);

	tracker.reset();
	assert.equal(readOnly.tokenRate, 0);
	assert.equal(tracker.sample(100, 2_000), 0);
});
