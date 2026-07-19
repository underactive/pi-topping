import assert from "node:assert/strict";
import test from "node:test";

import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import type { TUI } from "@earendil-works/pi-tui";

import { MenuComponent, type MenuConfig, type MenuResult } from "../src/menu.ts";

const KEY = {
	up: "\x1b[A",
	down: "\x1b[B",
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
const RESET = "\x1b[0m";

function fakeTheme(): Theme {
	return {
		fg: (color: string, text: string) => `${FG_CODES[color] ?? ""}${text}${RESET}`,
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
	done: (result: MenuResult<Record<string, boolean>>) => void,
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
		assert.ok(visibleWidth(line) <= 64, `line exceeds width: ${JSON.stringify(line)}`);
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

test("arrow keys move the cursor with wrap-around in both directions", () => {
	const menu = makeMenu(() => {});

	function selectedLabel(): string {
		const lines = menu.render(64).map(stripTags);
		const row = lines.find((l) => l.includes("\u25b8"))!;
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

test("enter applies the current (possibly toggled) values", () => {
	let result: MenuResult<Record<string, boolean>> | undefined;
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
	let result: MenuResult<Record<string, boolean>> | undefined;
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
	const calls: { values: Record<string, boolean>; elapsedMs: number }[] = [];
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

test("dispose() stops the preview animation timer when a TUI is provided", (t) => {
	const timers: { started: number; cleared: unknown[] } = { started: 0, cleared: [] };
	t.mock.method(globalThis, "setInterval", ((..._args: unknown[]) => {
		timers.started++;
		return 99 as unknown as NodeJS.Timeout;
	}) as unknown as typeof setInterval);
	t.mock.method(globalThis, "clearInterval", ((handle: unknown) => {
		timers.cleared.push(handle);
	}) as typeof clearInterval);

	const fakeTui = { requestRender: () => {} } as unknown as TUI;
	const menu = makeMenu(() => {}, { preview: () => ["x"] }, fakeTui);

	assert.equal(timers.started, 1);
	menu.dispose();
	assert.deepEqual(timers.cleared, [99]);

	// Calling dispose() again is a safe no-op.
	menu.dispose();
	assert.deepEqual(timers.cleared, [99]);
});

test("dispose() is a safe no-op when there is no preview or no TUI", () => {
	const withoutPreview = makeMenu(() => {});
	assert.doesNotThrow(() => withoutPreview.dispose());

	const withPreviewNoTui = makeMenu(() => {}, { preview: () => ["x"] });
	assert.doesNotThrow(() => withPreviewNoTui.dispose());
});
