import assert from "node:assert/strict";
import test from "node:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import type { TUI } from "@earendil-works/pi-tui";

import { MenuComponent, type MenuConfig, type MenuResult, type MenuValue } from "../src/menu.ts";

const KEY = {
	up: "\x1b[A",
	down: "\x1b[B",
	left: "\x1b[D",
	right: "\x1b[C",
	space: " ",
	enter: "\r",
	escape: "\x1b",
};

// Real ANSI SGR codes so visibleWidth()/truncateToWidth() (which strip ANSI,
// not arbitrary tags) compute widths the same way they would with the real
// theme.
const FG_CODES: Record<string, string> = {
	accent: "\x1b[36m",
	success: "\x1b[32m",
	muted: "\x1b[90m",
	dim: "\x1b[2m",
	text: "\x1b[39m",
};
const BG_CODES: Record<string, string> = {
	selectedBg: "\x1b[48;5;238m",
};
const RESET = "\x1b[0m";

function fakeTheme(): Theme {
	return {
		fg: (color: string, text: string) => `${FG_CODES[color] ?? ""}${text}${RESET}`,
		bg: (color: string, text: string) => `${BG_CODES[color] ?? ""}${text}\x1b[49m`,
		bold: (text: string) => `\x1b[1m${text}${RESET}`,
	} as unknown as Theme;
}

function stripTags(text: string): string {
	// eslint-disable-next-line no-control-regex
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function baseConfig(): MenuConfig {
	return {
		title: "TEST",
		sections: [
			{
				title: "S1",
				items: [
					{ id: "a", label: "Item A", value: true },
					{ id: "b", label: "Item B", value: false },
				],
			},
			{
				title: "S2",
				items: [{ id: "c", label: "Item C", value: true }],
			},
		],
	};
}

function makeMenu(
	done: (result: MenuResult<Record<string, MenuValue>>) => void,
	overrides: Partial<MenuConfig> = {},
	tui?: TUI,
): MenuComponent {
	return new MenuComponent({ ...baseConfig(), ...overrides }, fakeTheme(), done, tui);
}

test("render produces a well-formed frame at the requested width", () => {
	const menu = makeMenu(() => {});
	const lines = menu.render(64);

	// top + (divider + 2 items + blank) + (divider + 1 item + blank) + separator + footer + bottom
	assert.equal(lines.length, 1 + (1 + 2 + 1) + (1 + 1 + 1) + 1 + 1 + 1);

	for (const line of lines) {
		assert.equal(visibleWidth(line), 64, `line does not fill the overlay: ${JSON.stringify(line)}`);
	}

	const plain = lines.map(stripTags);
	assert.ok(plain[0]!.includes("\u2554\u2550[ TEST "));
	assert.ok(plain.some((l) => l.includes("\u255f\u2500 S1 ")));
	assert.ok(plain.some((l) => l.includes("\u255f\u2500 S2 ")));
	assert.ok(plain.some((l) => l.includes("ON")));
	assert.ok(plain.some((l) => l.includes("OFF")));
	assert.ok(plain.at(-1)!.includes("\u255a"));
	assert.ok(plain.at(-1)!.includes("[ 1/3 ]"));
});

test("scrolls the item body to fit a 24-row terminal while keeping chrome and cursor visible", (t) => {
	const terminal = { rows: 24 };
	const tui = { terminal, requestRender: () => {} } as unknown as TUI;
	const menu = new MenuComponent({
		title: "TEST",
		sections: [{ title: "Many settings", items: Array.from({ length: 20 }, (_, i) => ({ id: `item-${i}`, label: `Item ${i}`, value: true })) }],
		preview: () => ["preview"],
	}, fakeTheme(), () => {}, tui);
	t.after(() => menu.dispose());

	let lines = menu.render(64).map(stripTags);
	assert.equal(lines.length, 24);
	assert.ok(lines[0]!.includes("╔═[ TEST "));
	assert.ok(lines.at(-1)!.includes("[ 1/20 ]"));
	assert.ok(lines.some((line) => line.includes("Item 0") && line.includes("❯")));
	assert.ok(lines.some((line) => line.includes("↓ more below")));

	for (let i = 0; i < 15; i++) menu.handleInput(KEY.down);
	lines = menu.render(64).map(stripTags);
	assert.equal(lines.length, 24);
	assert.ok(lines.some((line) => line.includes("Item 15") && line.includes("❯")));
	assert.ok(lines.some((line) => line.includes("↑ more above") && line.includes("↓ more below")));
	assert.ok(lines.at(-1)!.includes("[ 16/20 ]"));

	for (let i = 0; i < 4; i++) menu.handleInput(KEY.down);
	lines = menu.render(64).map(stripTags);
	assert.ok(lines.some((line) => line.includes("Item 19") && line.includes("❯")));
	assert.ok(lines.some((line) => line.includes("↑ more above")));
	assert.ok(!lines.some((line) => line.includes("↓ more below")));
	assert.ok(lines.at(-1)!.includes("[ 20/20 ]"));

	// A taller terminal is detected without reconstructing the component and
	// reveals the complete natural-height menu rather than adding empty rows.
	terminal.rows = 40;
	lines = menu.render(64).map(stripTags);
	assert.equal(lines.length, 30);
	assert.ok(lines.some((line) => line.includes("Item 0")));
	assert.ok(lines.some((line) => line.includes("Item 19")));
	assert.ok(!lines.some((line) => line.includes("more above") || line.includes("more below")));
});

test("a section starting near the window bottom keeps its heading instead of folding into the previous section", (t) => {
	const terminal = { rows: 10 };
	const tui = { terminal, requestRender: () => {} } as unknown as TUI;
	const menu = new MenuComponent({
		title: "TEST",
		sections: [
			{ title: "Alpha", items: Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, label: `Alpha ${i}`, value: true })) },
			{ title: "Beta", items: [{ id: "b", label: "Use NerdFont icons", value: true }] },
		],
	}, fakeTheme(), () => {}, tui);
	t.after(() => menu.dispose());

	// Park the cursor on the lone final-section item with only one body row left
	// for it; the old behavior dropped the divider and folded it in.
	for (let i = 0; i < 4; i++) menu.handleInput(KEY.down);
	const lines = menu.render(64).map(stripTags);

	assert.equal(lines.length, 10);
	const betaDividerIndex = lines.findIndex((l) => l.includes("\u255f\u2500 Beta "));
	const itemIndex = lines.findIndex((l) => l.includes("Use NerdFont icons"));
	assert.ok(itemIndex >= 0, "the selected Beta item must be visible");
	assert.ok(betaDividerIndex >= 0, "the Beta heading must not disappear");
	assert.ok(betaDividerIndex < itemIndex, "the Beta heading must sit above its item");
	assert.match(lines[betaDividerIndex - 1]!, /^\u2551\s+\u2551$/, "a blank row must separate the Beta heading from the section above");
	assert.ok(lines[itemIndex]!.includes("\u276f"), "cursor stays on the Beta item");
});

test("arrow keys move the cursor with wrap-around in both directions", () => {
	const menu = makeMenu(() => {});

	function selectedLabel(): string {
		const lines = menu.render(64).map(stripTags);
		const row = lines.find((l) => l.includes("\u276f"))!;
		return row.includes("Item A") ? "a" : row.includes("Item B") ? "b" : "c";
	}

	// Cursor starts on the first item.
	assert.equal(selectedLabel(), "a");

	menu.handleInput(KEY.down);
	assert.equal(selectedLabel(), "b");

	menu.handleInput(KEY.down);
	assert.equal(selectedLabel(), "c");

	// Down from the last item wraps to the first.
	menu.handleInput(KEY.down);
	assert.equal(selectedLabel(), "a");

	// Up from the first item wraps to the last.
	menu.handleInput(KEY.up);
	assert.equal(selectedLabel(), "c");
});

test("space toggles the selected item's value", () => {
	const menu = makeMenu(() => {});
	const before = menu.render(64).map(stripTags).find((l) => l.includes("Item A"))!;
	assert.ok(before.includes("ON"));

	menu.handleInput(KEY.space);
	const after = menu.render(64).map(stripTags).find((l) => l.includes("Item A"))!;
	assert.ok(after.includes("OFF"));
});

test("left/right cycle multi-value items without changing boolean toggle behavior", () => {
	let result: MenuResult<Record<string, MenuValue>> | undefined;
	const menu = new MenuComponent({
		title: "TEST",
		sections: [{ title: "S1", items: [
			{ id: "color", label: "Border color", value: "accent", cycleValues: ["accent", "border", "borderAccent"] },
			{ id: "enabled", label: "Enabled", value: true },
		] }],
	}, fakeTheme(), (value) => { result = value; });

	menu.handleInput(KEY.right);
	assert.ok(menu.render(64).map(stripTags).some((line) => line.includes("‹ border ›")));
	menu.handleInput(KEY.space);
	assert.ok(menu.render(64).map(stripTags).some((line) => line.includes("‹ border ›")), "space does not toggle a cycle item");
	menu.handleInput(KEY.left);
	menu.handleInput(KEY.left);
	assert.ok(menu.render(64).map(stripTags).some((line) => line.includes("‹ borderAccent ›")));
	menu.handleInput(KEY.down);
	menu.handleInput(KEY.space);
	menu.handleInput(KEY.enter);

	assert.equal(result!.values.color, "borderAccent");
	assert.equal(result!.values.enabled, false);
});

test("gated cycle item: checkbox resets to disabled value and blocks arrows until re-checked", () => {
	let result: MenuResult<Record<string, MenuValue>> | undefined;
	const menu = new MenuComponent({
		title: "TEST",
		sections: [{ title: "S1", items: [
			{ id: "color", label: "Border color", value: "accent", cycleValues: ["accent", "border", "borderAccent"], cycleEnabledBy: "colorEnabled", cycleEnabled: true, cycleDisabledValue: "border" },
		] }],
	}, fakeTheme(), (value) => { result = value; });

	// Checked by default: checkbox renders filled and arrows cycle.
	const checked = menu.render(64).map(stripTags).find((l) => l.includes("Border color"))!;
	assert.ok(checked.includes("[■]"), `expected filled checkbox: ${JSON.stringify(checked)}`);
	menu.handleInput(KEY.right);
	assert.ok(menu.render(64).map(stripTags).some((line) => line.includes("‹ border ›")));
	menu.handleInput(KEY.right);
	assert.ok(menu.render(64).map(stripTags).some((line) => line.includes("‹ borderAccent ›")));

	// Uncheck: resets to the disabled value, renders empty checkbox, arrows are no-ops.
	menu.handleInput(KEY.space);
	let lines = menu.render(64).map(stripTags);
	assert.ok(lines.some((l) => l.includes("Border color") && l.includes("[ ]")), `expected empty checkbox: ${JSON.stringify(lines)}`);
	assert.ok(lines.some((line) => line.includes("‹ border ›")));
	menu.handleInput(KEY.right);
	menu.handleInput(KEY.left);
	assert.ok(menu.render(64).map(stripTags).some((line) => line.includes("‹ border ›")), "arrows must not change a disabled cycle item");

	// Re-check: cycling works again.
	menu.handleInput(KEY.space);
	lines = menu.render(64).map(stripTags);
	assert.ok(lines.some((l) => l.includes("Border color") && l.includes("[■]")));
	menu.handleInput(KEY.left);
	assert.ok(menu.render(64).map(stripTags).some((line) => line.includes("‹ accent ›")));

	menu.handleInput(KEY.enter);
	assert.equal(result!.values.color, "accent");
	assert.equal(result!.values.colorEnabled, true);
});

function reorderConfig(): MenuConfig {
	return {
		title: "TEST",
		sections: [
			{ title: "S1", items: [{ id: "before", label: "Before", value: true }] },
			{
				title: "Order",
				items: ["one", "two", "three"].map((id) => ({ id, label: `Row ${id}`, value: false, reorderGroup: "order" })),
			},
			{ title: "S2", items: [{ id: "after", label: "After", value: true }] },
		],
	};
}

function rowOrder(menu: MenuComponent): string[] {
	return menu
		.render(64)
		.map(stripTags)
		.flatMap((line) => {
			const match = line.match(/Row (one|two|three)/);
			return match ? [match[1]!] : [];
		});
}

test("reorder rows publish their group order and show the arrow affordance only while grabbed", () => {
	let result: MenuResult<Record<string, MenuValue>> | undefined;
	const menu = new MenuComponent(reorderConfig(), fakeTheme(), (r) => { result = r; });

	assert.ok(!menu.render(64).map(stripTags).some((l) => l.includes("↑ ↓")));

	menu.handleInput(KEY.down); // onto "one"
	menu.handleInput(KEY.space); // grab it
	const grabbed = menu.render(64).map(stripTags);
	const arrowRows = grabbed.filter((l) => l.includes("↑ ↓"));
	assert.equal(arrowRows.length, 1);
	assert.ok(arrowRows[0]!.includes("Row one") && arrowRows[0]!.includes("[■]"));

	menu.handleInput(KEY.down);
	assert.deepEqual(rowOrder(menu), ["two", "one", "three"]);

	menu.handleInput(KEY.space); // release
	assert.ok(!menu.render(64).map(stripTags).some((l) => l.includes("↑ ↓")));

	menu.handleInput(KEY.enter);
	assert.equal(result!.values.order, "two,one,three");
});

test("a grabbed row clamps at its group edges and cannot escape into neighboring sections", () => {
	const menu = new MenuComponent(reorderConfig(), fakeTheme(), () => {});

	menu.handleInput(KEY.down); // onto "one"
	menu.handleInput(KEY.space); // grab
	for (let i = 0; i < 5; i++) menu.handleInput(KEY.up);
	assert.deepEqual(rowOrder(menu), ["one", "two", "three"]);

	for (let i = 0; i < 5; i++) menu.handleInput(KEY.down);
	assert.deepEqual(rowOrder(menu), ["two", "three", "one"]);

	// The cursor stayed on the grabbed row the whole time, so releasing and
	// stepping down lands on the next section rather than somewhere upstream.
	menu.handleInput(KEY.space);
	menu.handleInput(KEY.down);
	const selected = menu.render(64).map(stripTags).find((l) => l.includes("❯"))!;
	assert.ok(selected.includes("After"), `expected the cursor on "After": ${JSON.stringify(selected)}`);
});

test("reordering keeps the scrolling window and the natural-height body in sync", () => {
	const terminal = { rows: 40 };
	const tui = { terminal, requestRender: () => {} } as unknown as TUI;
	const menu = new MenuComponent(reorderConfig(), fakeTheme(), () => {}, tui);

	menu.handleInput(KEY.down);
	menu.handleInput(KEY.space);
	menu.handleInput(KEY.down);
	const natural = rowOrder(menu);

	terminal.rows = 9; // forces the scrolling window path
	menu.invalidate();
	const scrolled = menu.render(64).map(stripTags).flatMap((line) => {
		const match = line.match(/Row (one|two|three)/);
		return match ? [match[1]!] : [];
	});

	assert.deepEqual(natural, ["two", "one", "three"]);
	assert.deepEqual(scrolled, natural.slice(0, scrolled.length));
});

test("enter applies the current (possibly toggled) values", () => {
	let result: MenuResult<Record<string, MenuValue>> | undefined;
	const menu = makeMenu((r) => {
		result = r;
	});

	menu.handleInput(KEY.space); // toggle "a" off
	menu.handleInput(KEY.enter);

	assert.ok(result);
	assert.equal(result!.applied, true);
	assert.equal(result!.values.a, false);
	assert.equal(result!.values.b, false);
	assert.equal(result!.values.c, true);
});

test("escape cancels and restores the original values", () => {
	let result: MenuResult<Record<string, MenuValue>> | undefined;
	const menu = makeMenu((r) => {
		result = r;
	});

	menu.handleInput(KEY.space); // toggle "a" off
	menu.handleInput(KEY.escape);

	assert.ok(result);
	assert.equal(result!.applied, false);
	assert.equal(result!.values.a, true);
	assert.equal(result!.values.b, false);
	assert.equal(result!.values.c, true);
});

test("render never exceeds a narrow width even with long labels", () => {
	const menu = new MenuComponent(
		{
			title: "A REALLY LONG SETTINGS MENU TITLE THAT WONT FIT",
			sections: [
				{
					title: "SECTION",
					items: [
						{ id: "x", label: "A very long toggle label that should be truncated safely", value: true },
					],
				},
			],
		},
		fakeTheme(),
		() => {},
	);

	const lines = menu.render(20);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 20, `line exceeds width: ${JSON.stringify(line)}`);
	}
});

test("preview renders a Preview section reflecting the current toggle values", () => {
	const calls: { values: Record<string, MenuValue>; elapsedMs: number }[] = [];
	const menu = makeMenu(() => {}, {
		preview: (values, elapsedMs) => {
			calls.push({ values: { ...values }, elapsedMs });
			return [`preview: a=${values.a} b=${values.b}`];
		},
	});

	const lines = menu.render(64).map(stripTags);
	assert.ok(lines.some((l) => l.includes("\u255f\u2500 Preview ")));
	assert.ok(lines.some((l) => l.includes("preview: a=true b=false")));
	assert.equal(calls.length, 1);
	assert.equal(calls[0]!.values.a, true);

	menu.handleInput(KEY.space); // toggle "a" off
	const after = menu.render(64).map(stripTags);
	assert.ok(after.some((l) => l.includes("preview: a=false b=false")));
	assert.equal(calls.length, 2);
});

test("preview section has a blank row above the content and a one-space left indent", () => {
	const menu = makeMenu(() => {}, { preview: () => ["X"] });

	const lines = menu.render(64).map(stripTags);
	const dividerIndex = lines.findIndex((l) => l.includes("\u255f\u2500 Preview "));
	assert.ok(dividerIndex >= 0, "expected a Preview divider row");

	const blankRow = lines[dividerIndex + 1]!;
	const contentRow = lines[dividerIndex + 2]!;

	// A blank row sits directly under the divider, above the preview content.
	assert.match(blankRow, /^\u2551\s+\u2551$/);

	// The content row is indented by exactly one space past the left border.
	assert.ok(contentRow.startsWith("\u2551 X"), `expected one leading space: ${JSON.stringify(contentRow)}`);
	assert.ok(!contentRow.startsWith("\u2551  X"), `expected exactly one leading space: ${JSON.stringify(contentRow)}`);
});

test("preview is sampled exactly once per render, even for repeated calls at the same width", () => {
	let callCount = 0;
	const menu = makeMenu(() => {}, {
		preview: () => {
			callCount++;
			return ["static preview"];
		},
	});

	menu.render(64);
	assert.equal(callCount, 1);

	// Cached render at the same width must not re-invoke preview().
	menu.render(64);
	assert.equal(callCount, 1);

	// A fresh render (after invalidate) samples exactly once more.
	menu.invalidate();
	menu.render(64);
	assert.equal(callCount, 2);
});

test("without a preview config, no Preview section is rendered", () => {
	const menu = makeMenu(() => {});
	const lines = menu.render(64).map(stripTags);
	assert.ok(!lines.some((l) => l.includes("Preview")));
});

test("preview lines are padded/truncated to fit and never exceed the requested width", () => {
	const menu = makeMenu(() => {}, {
		preview: () => ["a very long simulated working message that could overflow the box width easily"],
	});

	const lines = menu.render(40);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 40, `line exceeds width: ${JSON.stringify(line)}`);
	}
});

test("dispose() stops the preview refresh timer when a TUI is provided", (t) => {
	const timers: { delays: (number | undefined)[]; cleared: unknown[] } = { delays: [], cleared: [] };
	t.mock.method(globalThis, "setTimeout", ((_callback: () => void, delay?: number) => {
		timers.delays.push(delay);
		return 99 as unknown as NodeJS.Timeout;
	}) as unknown as typeof setTimeout);
	t.mock.method(globalThis, "clearTimeout", ((handle: unknown) => {
		timers.cleared.push(handle);
	}) as typeof clearTimeout);

	const fakeTui = { requestRender: () => {} } as unknown as TUI;
	const menu = makeMenu(() => {}, { preview: () => ["x"] }, fakeTui);

	assert.deepEqual(timers.delays, [50]);
	menu.dispose();
	assert.deepEqual(timers.cleared, [99]);

	// Calling dispose() again is a safe no-op.
	menu.dispose();
	assert.deepEqual(timers.cleared, [99]);
});

test("static PreviewResult previews do not schedule a refresh timer", (t) => {
	let timeouts = 0;
	t.mock.method(globalThis, "setTimeout", ((..._args: unknown[]) => {
		timeouts++;
		return 99 as unknown as NodeJS.Timeout;
	}) as unknown as typeof setTimeout);

	const fakeTui = { requestRender: () => {} } as unknown as TUI;
	const menu = makeMenu(() => {}, { preview: () => ({ lines: ["static"] }) }, fakeTui);
	menu.render(64);

	assert.equal(timeouts, 0);
	menu.dispose();
});

test("PreviewResult schedules its declared refresh delay", (t) => {
	const timers: { delays: (number | undefined)[]; cleared: unknown[] } = { delays: [], cleared: [] };
	t.mock.method(globalThis, "setTimeout", ((_callback: () => void, delay?: number) => {
		timers.delays.push(delay);
		return 99 as unknown as NodeJS.Timeout;
	}) as unknown as typeof setTimeout);
	t.mock.method(globalThis, "clearTimeout", ((handle: unknown) => {
		timers.cleared.push(handle);
	}) as typeof clearTimeout);

	const fakeTui = { requestRender: () => {} } as unknown as TUI;
	const menu = makeMenu(() => {}, { preview: () => ({ lines: ["animated"], nextRefreshInMs: 100 }) }, fakeTui);

	assert.deepEqual(timers.delays, [100]);
	menu.dispose();
	assert.deepEqual(timers.cleared, [99]);
});

test("switching from a static preview to an animated one starts and stops its timer", (t) => {
	const timers: { delays: (number | undefined)[]; cleared: unknown[] } = { delays: [], cleared: [] };
	t.mock.method(globalThis, "setTimeout", ((_callback: () => void, delay?: number) => {
		timers.delays.push(delay);
		return 99 as unknown as NodeJS.Timeout;
	}) as unknown as typeof setTimeout);
	t.mock.method(globalThis, "clearTimeout", ((handle: unknown) => {
		timers.cleared.push(handle);
	}) as typeof clearTimeout);

	const fakeTui = { requestRender: () => {} } as unknown as TUI;
	const menu = makeMenu(() => {}, {
		preview: (_values, _elapsedMs, activeItemId) =>
			activeItemId === "a"
				? { lines: ["static"] }
				: { lines: ["animated"], nextRefreshInMs: 80 },
	}, fakeTui);

	menu.handleInput(KEY.down);
	menu.render(64);
	assert.deepEqual(timers.delays, [80]);

	menu.handleInput(KEY.up);
	menu.render(64);
	assert.deepEqual(timers.cleared, [99]);
	menu.dispose();
});

test("dispose() is a safe no-op when there is no preview or no TUI", () => {
	const withoutPreview = makeMenu(() => {});
	assert.doesNotThrow(() => withoutPreview.dispose());

	const withPreviewNoTui = makeMenu(() => {}, { preview: () => ["x"] });
	assert.doesNotThrow(() => withPreviewNoTui.dispose());
});

test("selected item row includes selectedBg highlight", () => {
	const menu = makeMenu(() => {});
	const lines = menu.render(64);

	const itemA = lines.find((l) => l.includes("Item A"))!;
	const itemB = lines.find((l) => l.includes("Item B"))!;

	assert.ok(itemA.includes(BG_CODES.selectedBg), "selected item A must have selectedBg");
	assert.ok(!itemB.includes(BG_CODES.selectedBg), "unselected item B must not have selectedBg");
});
