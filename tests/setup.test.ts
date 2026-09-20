import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CustomEntry, ExtensionAPI, ExtensionCommandContext, ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import workingDecorator from "../index.ts";
import type { PiInstallResult } from "../src/pi-installer.ts";
import { registerSetupCommand } from "../src/setup-command.ts";
import { isSetupCheckDisabled } from "../src/setup-check.ts";
import {
	__resetSetupNotice,
	announceMissingToppingsOnce,
	detectToppings,
	type MissingToppingsEntryData,
	renderMissingToppingsEntry,
	SETUP_ENTRY_TYPE,
	TOPPINGS,
} from "../src/toppings.ts";

type Notification = { message: string; type?: string };
type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type Command = { description?: string; handler: CommandHandler };
type RuntimeCommand = { name: string; source: "extension"; sourceInfo: { path: string } };
type AppendedEntry = { customType: string; data?: unknown };
type CustomComponent = { render(width: number): string[]; handleInput?(data: string): void; dispose?(): void };
type CustomFactory<T> = (tui: unknown, theme: unknown, keybindings: unknown, done: (result: T) => void) => CustomComponent;

class MockExtension {
	readonly commands: Record<string, Command> = {};
	readonly appendedEntries: AppendedEntry[] = [];
	readonly entryRenderers: Record<string, (entry: unknown, options: unknown, theme: unknown) => unknown> = {};
	readonly #handlers: { session_start?: (event: SessionStartEvent, ctx: ExtensionContext) => Promise<void> | void } = {};
	readonly #getCommands: () => RuntimeCommand[];

	constructor(getCommands: () => RuntimeCommand[] = () => []) {
		this.#getCommands = getCommands;
	}

	on(name: string, handler: (event: SessionStartEvent, ctx: ExtensionContext) => Promise<void> | void): () => void {
		if (name === "session_start") this.#handlers.session_start = handler;
		return () => {};
	}

	registerCommand(name: string, command: Command): void {
		this.commands[name] = command;
	}

	appendEntry(customType: string, data?: unknown): void {
		this.appendedEntries.push({ customType, data });
	}

	registerEntryRenderer(customType: string, renderer: (entry: unknown, options: unknown, theme: unknown) => unknown): void {
		this.entryRenderers[customType] = renderer;
	}

	registerMessageRenderer(): void {}

	getCommands(): RuntimeCommand[] {
		return this.#getCommands();
	}

	async emitSessionStart(ctx: ExtensionContext): Promise<void> {
		await this.#handlers.session_start?.({ type: "session_start", reason: "startup" }, ctx);
	}

	asAPI(): ExtensionAPI {
		return this as unknown as ExtensionAPI;
	}
}

function runtimeCommands(): RuntimeCommand[] {
	return [
		{ name: "topping-statusline-settings", source: "extension", sourceInfo: { path: "/extensions/pi-topping-statusline/index.ts" } },
		{ name: "topping-splash-settings", source: "extension", sourceInfo: { path: "/extensions/pi-topping-splash/index.ts" } },
		{ name: "persona-audit", source: "extension", sourceInfo: { path: "/extensions/pi-topping-persona-audit/index.ts" } },
		{ name: "browser", source: "extension", sourceInfo: { path: "/extensions/pi-topping-web-tools/index.ts" } },
		{ name: "mf-plan", source: "extension", sourceInfo: { path: "/extensions/pi-topping-moa-fusion/index.ts" } },
	];
}

function createContext(
	notifications: Notification[],
	options?: {
		mode?: "tui" | "print";
		onCustomComponent?: (component: CustomComponent) => void;
		fg?: (color: string, text: string) => string;
	},
): ExtensionCommandContext {
	const theme = {
		fg: options?.fg ?? ((_color: string, text: string) => text),
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		getThinkingBorderColor: (_level: string) => (text: string) => text,
	};
	const tui = { requestRender: () => {} };
	return {
		hasUI: true,
		mode: options?.mode ?? "tui",
		ui: {
			theme,
			notify(message: string, type?: string) {
				notifications.push({ message, type });
			},
			setWorkingMessage() {},
			setWorkingIndicator() {},
			setStatus() {},
			custom<T>(factory: CustomFactory<T>): Promise<T> {
				return new Promise<T>((resolve) => {
					let component: CustomComponent | undefined;
					const done = (result: T): void => {
						component?.dispose?.();
						resolve(result);
					};
					component = factory(tui, theme, {}, done);
					options?.onCustomComponent?.(component);
				});
			},
		},
	} as unknown as ExtensionCommandContext;
}

async function withTempAgentDir<T>(fn: (dir: string) => Promise<T> | T): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), "pi-topping-setup-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		return await fn(dir);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
}

function completedInstall(): Promise<PiInstallResult> {
	return Promise.resolve({ code: 0, stdout: "", stderr: "" });
}

async function waitForComponent(component: () => CustomComponent | undefined): Promise<CustomComponent> {
	for (let attempt = 0; attempt < 5; attempt++) {
		const current = component();
		if (current) return current;
		await new Promise((resolve) => setImmediate(resolve));
	}
	throw new Error("expected setup menu component");
}

test("detectToppings uses runtime command paths when available", async () => {
	await withTempAgentDir(() => {
		const statuses = detectToppings(new MockExtension(runtimeCommands).asAPI());
		assert.ok(statuses.every((status) => status.active));
		assert.ok(statuses.every((status) => !status.onDisk));
	});
});

test("detectToppings falls back to settings packages and handles unavailable runtime commands", async () => {
	await withTempAgentDir((dir) => {
		writeFileSync(join(dir, "settings.json"), JSON.stringify({
			packages: ["npm:@underactive/pi-topping-splash"],
			extensions: ["-npm:@underactive/pi-topping-persona-audit"],
		}));
		const fromEmptyCommands = detectToppings(new MockExtension().asAPI());
		const splash = fromEmptyCommands.find((status) => status.topping.pkg.endsWith("splash"))!;
		const persona = fromEmptyCommands.find((status) => status.topping.pkg.endsWith("persona-audit"))!;
		assert.deepEqual({ active: splash.active, onDisk: splash.onDisk }, { active: true, onDisk: true });
		assert.deepEqual({ active: persona.active, onDisk: persona.onDisk }, { active: false, onDisk: true });

		mkdirSync(join(dir, "extensions", "pi-topping-statusline"), { recursive: true });
		const unavailableRuntime = new MockExtension(() => {
			throw new Error("Extension runtime not initialized");
		});
		const statusline = detectToppings(unavailableRuntime.asAPI()).find((status) => status.topping.pkg.endsWith("statusline"))!;
		assert.deepEqual({ active: statusline.active, onDisk: statusline.onDisk }, { active: true, onDisk: true });
	});
});

test("detectToppings publishes only exact package sources as removable", async () => {
	await withTempAgentDir((dir) => {
		writeFileSync(join(dir, "settings.json"), JSON.stringify({
			packages: [
				"npm:@underactive/pi-topping-statusline",
				"npm:@underactive/pi-topping-splash@1.2.3",
				{ source: "npm:@underactive/pi-topping-persona-audit" },
				"npm:@other/pi-topping-web-tools",
			],
			extensions: ["npm:@underactive/pi-topping-web-tools"],
		}));
		mkdirSync(join(dir, "extensions", "pi-topping-moa-fusion"), { recursive: true });

		const statuses = detectToppings(new MockExtension().asAPI());
		assert.equal(statuses.find(({ topping }) => topping.pkg.endsWith("statusline"))!.packageSource, "npm:@underactive/pi-topping-statusline");
		assert.equal(statuses.find(({ topping }) => topping.pkg.endsWith("splash"))!.packageSource, "npm:@underactive/pi-topping-splash@1.2.3");
		assert.equal(statuses.find(({ topping }) => topping.pkg.endsWith("persona-audit"))!.packageSource, "npm:@underactive/pi-topping-persona-audit");
		assert.equal(statuses.find(({ topping }) => topping.pkg.endsWith("web-tools"))!.packageSource, undefined);
		assert.equal(statuses.find(({ topping }) => topping.pkg.endsWith("moa-fusion"))!.packageSource, undefined);
	});
});

test("/topping-setup reports when all extensions are active and requires TUI mode", async () => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension(runtimeCommands);
		registerSetupCommand(extension.asAPI(), () => completedInstall());
		const command = extension.commands["topping-setup"];
		assert.ok(command, "expected /topping-setup to be registered");

		const activeNotifications: Notification[] = [];
		await command!.handler("", createContext(activeNotifications));
		assert.deepEqual(activeNotifications, [{ message: "All Pi Topping extensions are already active in this session.", type: "info" }]);

		const printNotifications: Notification[] = [];
		await command!.handler("", createContext(printNotifications, { mode: "print" }));
		assert.deepEqual(printNotifications, [{ message: "/topping-setup requires TUI mode", type: "error" }]);
	});
});

test("/topping-setup disable-side-toppings-check suppresses the missing-extension notice", async () => {
	await withTempAgentDir(async () => {
		__resetSetupNotice();
		const extension = new MockExtension();
		registerSetupCommand(extension.asAPI(), () => completedInstall());
		const command = extension.commands["topping-setup"]!;

		const disabledNotifications: Notification[] = [];
		await command.handler("disable-side-toppings-check", createContext(disabledNotifications, { mode: "print" }));
		assert.equal(isSetupCheckDisabled(), true);
		assert.deepEqual(disabledNotifications, [{
			message: "Missing topping check disabled. Run `/topping-setup enable-side-toppings-check` to re-enable it.",
			type: "info",
		}]);

		announceMissingToppingsOnce(extension.asAPI());
		assert.equal(extension.appendedEntries.length, 0);

		const enabledNotifications: Notification[] = [];
		await command.handler("enable-side-toppings-check", createContext(enabledNotifications, { mode: "print" }));
		assert.equal(isSetupCheckDisabled(), false);
		assert.deepEqual(enabledNotifications, [{ message: "Missing topping check enabled.", type: "info" }]);

		__resetSetupNotice();
		announceMissingToppingsOnce(extension.asAPI());
		assert.equal(extension.appendedEntries.length, 1);
		const entry = extension.appendedEntries.at(0);
		assert.ok(entry);
		assert.equal(entry.customType, SETUP_ENTRY_TYPE);
		assert.deepEqual(
			(entry.data as { toppings: Array<{ pkg: string }> }).toppings.map(({ pkg }) => pkg),
			TOPPINGS.map(({ pkg }) => pkg),
		);
		const theme = createContext([], {
			fg: (color, text) => `<${color}>${text}</${color}>`,
		}).ui.theme;
		const component = renderMissingToppingsEntry(entry as CustomEntry<MissingToppingsEntryData>, theme);
		assert.ok(component);
		const lines = component.render(76);
		const rendered = lines.join("\n");
		assert.equal(lines[0], `<warning>${"─".repeat(76)}</warning>`);
		assert.equal(lines.at(-1), `<warning>${"─".repeat(76)}</warning>`);
		assert.match(rendered, /<text>pi-topping: 5 topping extensions missing<\/text>/);
		assert.match(rendered, /<accent>@underactive\/pi-topping-moa-fusion<\/accent>/);
		assert.match(rendered, /<accent>\/topping-setup<\/accent>/);
		assert.match(rendered, /<accent>\/topping-setup disable-side-toppings-check<\/accent>/);
		assert.doesNotMatch(rendered, /Warning:|[│╭╮╰╯]|`/);
		__resetSetupNotice();
	});
});

test("/topping-setup cancels without invoking its package runners", async () => {
	await withTempAgentDir(async () => {
		const installs: string[] = [];
		const removals: string[] = [];
		const extension = new MockExtension();
		registerSetupCommand(extension.asAPI(), async (spec) => {
			installs.push(spec);
			return await completedInstall();
		}, async (spec) => {
			removals.push(spec);
			return await completedInstall();
		});
		let component: CustomComponent | undefined;
		const notifications: Notification[] = [];
		const commandPromise = extension.commands["topping-setup"]!.handler("", createContext(notifications, { onCustomComponent: (captured) => { component = captured; } }));
		const menu = await waitForComponent(() => component);
		const rendered = menu.render(76).join("\n");
		for (const topping of TOPPINGS) assert.match(rendered, new RegExp(topping.pkg));
		menu.handleInput!("\x1b");
		await commandPromise;

		assert.deepEqual(installs, []);
		assert.deepEqual(removals, []);
		assert.deepEqual(notifications, [{ message: "Pi Topping setup cancelled.", type: "info" }]);
	});
});

test("/topping-setup describes the focused topping instead of listing selected installs", async () => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		registerSetupCommand(extension.asAPI(), () => completedInstall());
		let component: CustomComponent | undefined;
		const notifications: Notification[] = [];
		const commandPromise = extension.commands["topping-setup"]!.handler("", createContext(notifications, { onCustomComponent: (captured) => { component = captured; } }));
		const menu = await waitForComponent(() => component);

		const initial = menu.render(76).join("\n");
		assert.match(initial, /Description/);
		assert.doesNotMatch(initial, /Preview/);
		assert.match(initial, /status line customization/);
		const statuslineUrl = "https://pi.dev/packages/@underactive/pi-topping-statusline";
		const statuslineLink = `\x1b]8;;${statuslineUrl}\x1b\\${statuslineUrl}\x1b]8;;\x1b\\`;
		assert.ok(initial.includes(statuslineLink), "expected an OSC 8 hyperlink for the catalog URL");
		assert.doesNotMatch(initial, /Install:/);

		const narrow = menu.render(40).join("\n");
		const narrowLinkLine = narrow.split("\n").find((line) => line.includes(statuslineUrl));
		assert.ok(narrowLinkLine, "expected the catalog URL to remain visible in a narrow menu");
		const hyperlinkClose = "\x1b]8;;\x1b\\";
		const closeIndex = narrowLinkLine.lastIndexOf(hyperlinkClose);
		assert.ok(closeIndex >= 0, "narrow catalog hyperlink should be explicitly closed");
		assert.equal(narrowLinkLine.slice(closeIndex + hyperlinkClose.length).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").trim(), "...║");

		menu.handleInput!("\x1b[B");
		const afterMove = menu.render(76).join("\n");
		assert.match(afterMove, /startup splash screen/);
		const splashUrl = "https://pi.dev/packages/@underactive/pi-topping-splash";
		assert.ok(afterMove.includes(`\x1b]8;;${splashUrl}\x1b\\${splashUrl}\x1b]8;;\x1b\\`));
		assert.doesNotMatch(afterMove, /status line customization/);

		menu.handleInput!("\x1b");
		await commandPromise;
	});
});

test("/topping-setup installs only selected toppings and reports a restart", async () => {
	await withTempAgentDir(async () => {
		const installs: string[] = [];
		const extension = new MockExtension();
		registerSetupCommand(extension.asAPI(), async (spec) => {
			installs.push(spec);
			return await completedInstall();
		});
		let component: CustomComponent | undefined;
		const notifications: Notification[] = [];
		const commandPromise = extension.commands["topping-setup"]!.handler("", createContext(notifications, { onCustomComponent: (captured) => { component = captured; } }));
		const menu = await waitForComponent(() => component);
		menu.handleInput!(" "); // deselect the initially selected statusline topping
		menu.handleInput!("\r");
		await commandPromise;

		assert.deepEqual(installs, TOPPINGS.slice(1).map((topping) => `npm:${topping.pkg}`));
		assert.match(notifications.at(-1)!.message, /✓ Installed:/);
		assert.match(notifications.at(-1)!.message, /Restart Pi afterwards/);
		assert.equal(notifications.at(-1)!.type, "info");
	});
});

test("/topping-setup does not install when every topping is deselected", async () => {
	await withTempAgentDir(async () => {
		const installs: string[] = [];
		const extension = new MockExtension();
		registerSetupCommand(extension.asAPI(), async (spec) => {
			installs.push(spec);
			return await completedInstall();
		});
		let component: CustomComponent | undefined;
		const notifications: Notification[] = [];
		const commandPromise = extension.commands["topping-setup"]!.handler("", createContext(notifications, { onCustomComponent: (captured) => { component = captured; } }));
		const menu = await waitForComponent(() => component);
		for (const [index] of TOPPINGS.entries()) {
			if (index > 0) menu.handleInput!("\x1b[B");
			menu.handleInput!(" ");
		}
		menu.handleInput!("\r");
		await commandPromise;

		assert.deepEqual(installs, []);
		assert.deepEqual(notifications, [{ message: "No Pi Topping changes selected.", type: "info" }]);
	});
});

test("/topping-setup reports installer failures as warnings", async () => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		registerSetupCommand(extension.asAPI(), async () => ({ code: 1, stdout: "", stderr: "not found" }));
		let component: CustomComponent | undefined;
		const notifications: Notification[] = [];
		const commandPromise = extension.commands["topping-setup"]!.handler("", createContext(notifications, { onCustomComponent: (captured) => { component = captured; } }));
		const menu = await waitForComponent(() => component);
		menu.handleInput!("\r");
		await commandPromise;

		assert.match(notifications.at(-1)!.message, /✗ Failed:/);
		assert.match(notifications.at(-1)!.message, /not found/);
		assert.equal(notifications.at(-1)!.type, "warning");
	});
});

test("/topping-setup opens an installed-only menu with removals off by default", async () => {
	await withTempAgentDir(async (dir) => {
		writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: TOPPINGS.map(({ pkg }) => `npm:${pkg}`) }));
		const installs: string[] = [];
		const removals: string[] = [];
		const extension = new MockExtension(runtimeCommands);
		registerSetupCommand(extension.asAPI(), async (spec) => {
			installs.push(spec);
			return await completedInstall();
		}, async (spec) => {
			removals.push(spec);
			return await completedInstall();
		});
		let component: CustomComponent | undefined;
		const notifications: Notification[] = [];
		const commandPromise = extension.commands["topping-setup"]!.handler("", createContext(notifications, { onCustomComponent: (captured) => { component = captured; } }));
		const menu = await waitForComponent(() => component);
		const rendered = menu.render(76).join("\n");
		assert.match(rendered, /Installed Toppings/);
		assert.doesNotMatch(rendered, /Missing Toppings/);
		assert.equal(rendered.match(/OFF/g)?.length, TOPPINGS.length);
		assert.match(rendered, /Unchecked: no change/);
		menu.handleInput!("\r");
		await commandPromise;

		assert.deepEqual(installs, []);
		assert.deepEqual(removals, []);
		assert.deepEqual(notifications, [{ message: "No Pi Topping changes selected.", type: "info" }]);
	});
});

test("/topping-setup uninstalls checked package rows and updates the preview", async () => {
	await withTempAgentDir(async (dir) => {
		const topping = TOPPINGS[0]!;
		writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: [`npm:${topping.pkg}@1.2.3`] }));
		const installs: string[] = [];
		const removals: string[] = [];
		const extension = new MockExtension(runtimeCommands);
		registerSetupCommand(extension.asAPI(), async (spec) => {
			installs.push(spec);
			return await completedInstall();
		}, async (spec) => {
			removals.push(spec);
			return await completedInstall();
		});
		let component: CustomComponent | undefined;
		const notifications: Notification[] = [];
		const commandPromise = extension.commands["topping-setup"]!.handler("", createContext(notifications, { onCustomComponent: (captured) => { component = captured; } }));
		const menu = await waitForComponent(() => component);
		assert.match(menu.render(76).join("\n"), /Unchecked: no change/);
		menu.handleInput!(" ");
		assert.match(menu.render(76).join("\n"), /Checked: will uninstall/);
		menu.handleInput!("\r");
		await commandPromise;

		assert.deepEqual(installs, []);
		assert.deepEqual(removals, [`npm:${topping.pkg}`]);
		assert.match(notifications.at(-1)!.message, /✓ Removed:/);
		assert.match(notifications.at(-1)!.message, /Restart Pi afterwards/);
		assert.equal(notifications.at(-1)!.type, "info");
	});
});

test("/topping-setup runs removals before installs in a mixed batch", async () => {
	await withTempAgentDir(async (dir) => {
		writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: [`npm:${TOPPINGS[0]!.pkg}`] }));
		const calls: string[] = [];
		const extension = new MockExtension();
		registerSetupCommand(extension.asAPI(), async (spec) => {
			calls.push(`install:${spec}`);
			return await completedInstall();
		}, async (spec) => {
			calls.push(`remove:${spec}`);
			return await completedInstall();
		});
		let component: CustomComponent | undefined;
		const notifications: Notification[] = [];
		const commandPromise = extension.commands["topping-setup"]!.handler("", createContext(notifications, { onCustomComponent: (captured) => { component = captured; } }));
		const menu = await waitForComponent(() => component);
		for (let index = 0; index < TOPPINGS.length - 1; index++) menu.handleInput!("\x1b[B");
		menu.handleInput!(" ");
		menu.handleInput!("\r");
		await commandPromise;

		assert.equal(calls[0], `remove:npm:${TOPPINGS[0]!.pkg}`);
		assert.ok(calls.slice(1).every((call) => call.startsWith("install:")));
		assert.match(notifications.at(-1)!.message, /✓ Installed:/);
		assert.match(notifications.at(-1)!.message, /✓ Removed:/);
	});
});

test("/topping-setup reports remover failures as warnings", async () => {
	await withTempAgentDir(async (dir) => {
		writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: [`npm:${TOPPINGS[0]!.pkg}`] }));
		const extension = new MockExtension(runtimeCommands);
		registerSetupCommand(extension.asAPI(), () => completedInstall(), async () => ({ code: 1, stdout: "", stderr: "No matching package found" }));
		let component: CustomComponent | undefined;
		const notifications: Notification[] = [];
		const commandPromise = extension.commands["topping-setup"]!.handler("", createContext(notifications, { onCustomComponent: (captured) => { component = captured; } }));
		const menu = await waitForComponent(() => component);
		menu.handleInput!(" ");
		menu.handleInput!("\r");
		await commandPromise;

		assert.match(notifications.at(-1)!.message, /✗ Failed:/);
		assert.match(notifications.at(-1)!.message, /remove npm:/);
		assert.match(notifications.at(-1)!.message, /No matching package found/);
		assert.equal(notifications.at(-1)!.type, "warning");
	});
});

test("session_start appends the missing-toppings notice once per process", async () => {
	await withTempAgentDir(async () => {
		__resetSetupNotice();
		try {
			const extension = new MockExtension();
			const notifications: Notification[] = [];
			const ctx = createContext(notifications) as unknown as ExtensionContext;
			workingDecorator(extension.asAPI());
			assert.ok(extension.commands["topping-setup"], "expected setup command to be wired into the extension");
			assert.ok(extension.entryRenderers[SETUP_ENTRY_TYPE], "expected setup notice renderer to be registered");

			await extension.emitSessionStart(ctx);
			await extension.emitSessionStart(ctx);

			assert.equal(extension.appendedEntries.length, 1);
			assert.equal(extension.appendedEntries[0]!.customType, SETUP_ENTRY_TYPE);
			assert.deepEqual(notifications, []);
		} finally {
			__resetSetupNotice();
		}
	});
});
