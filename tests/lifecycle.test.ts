import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
	AgentSettledEvent,
	AgentStartEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	InputEvent,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

type AssistantMessage = {
	role: "assistant";
	content: unknown[];
	api: string;
	provider: string;
	model: string;
	usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number };
	stopReason: string;
	timestamp: number;
};
type MessageStartEvent = { type: "message_start"; message: { role: string } };
type MessageUpdateEvent = {
	type: "message_update";
	message: { role: string };
	assistantMessageEvent: { type: "text_delta" | "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage };
};
type MessageEndEvent = { type: "message_end"; message: AssistantMessage };
type ToolExecutionStartEvent = { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown };
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../settings.ts";
import workingDecorator from "../index.ts";

type TestedEvents = {
	input: InputEvent;
	agent_start: AgentStartEvent;
	agent_settled: AgentSettledEvent;
	session_start: SessionStartEvent;
	message_start: MessageStartEvent;
	message_update: MessageUpdateEvent;
	message_end: MessageEndEvent;
	tool_execution_start: ToolExecutionStartEvent;
};
type TestedEventName = keyof TestedEvents;
type Handler<K extends TestedEventName> = (event: TestedEvents[K], ctx: ExtensionContext) => Promise<void> | void;
type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type RegisteredCommandLike = { description?: string; handler: CommandHandler };

class MockExtension {
	readonly handlers: Partial<{ [K in TestedEventName]: Handler<K> }> = {};
	readonly commands: Record<string, RegisteredCommandLike> = {};
	readonly appendedEntries: { customType: string; data: unknown }[] = [];
	readonly entryRenderers: Record<string, (entry: unknown, options: unknown, theme: unknown) => unknown> = {};

	on<K extends TestedEventName>(name: K, handler: Handler<K>): void {
		this.handlers[name] = handler as never;
	}

	registerCommand(name: string, options: RegisteredCommandLike): void {
		this.commands[name] = options;
	}

	appendEntry(customType: string, data?: unknown): void {
		this.appendedEntries.push({ customType, data });
	}

	registerEntryRenderer(customType: string, renderer: (entry: unknown, options: unknown, theme: unknown) => unknown): void {
		this.entryRenderers[customType] = renderer;
	}

	async emit<K extends TestedEventName>(name: K, event: TestedEvents[K], ctx: ExtensionContext): Promise<void> {
		const handler = this.handlers[name] as Handler<K> | undefined;
		if (!handler) throw new Error(`No handler registered for ${name}`);
		await handler(event, ctx);
	}

	asAPI(): ExtensionAPI {
		return this as unknown as ExtensionAPI;
	}
}

type CustomFactory<T> = (
	tui: unknown,
	theme: unknown,
	keybindings: unknown,
	done: (result: T) => void,
) => unknown;

function createContext(
	messages: (string | undefined)[],
	indicators: unknown[],
	fg: (color: string, text: string) => string = (_color, text) => text,
	options?: {
		mode?: string;
		notifications?: { message: string; type?: string }[];
		onCustomComponent?: (component: { render(width: number): string[]; handleInput?(data: string): void; dispose?(): void }) => void;
	},
): ExtensionContext {
	const notifications = options?.notifications ?? [];
	const theme = { fg, bold: (text: string) => text };
	const fakeTui = { requestRender: () => {} };
	return {
		hasUI: true,
		mode: options?.mode ?? "tui",
		ui: {
			theme,
			setWorkingMessage(message?: string) {
				messages.push(message);
			},
			setWorkingIndicator(options?: unknown) {
				indicators.push(options);
			},
			notify(message: string, type?: string) {
				notifications.push({ message, type });
			},
			// Mirrors interactive-mode.js's showExtensionCustom(): resolves the
			// factory's component, hands it to the test via onCustomComponent, and
			// calls component.dispose?.() once `done()` closes the overlay.
			custom<T>(factory: CustomFactory<T>, _customOptions?: unknown): Promise<T> {
				return new Promise<T>((resolve) => {
					let component: { dispose?(): void } | undefined;
					const close = (result: T) => {
						try {
							component?.dispose?.();
						} catch {
							/* ignore */
						}
						resolve(result);
					};
					const produced = factory(fakeTui, theme, {}, close);
					Promise.resolve(produced).then((c) => {
						component = c as { dispose?(): void };
						options?.onCustomComponent?.(
							c as { render(width: number): string[]; handleInput?(data: string): void; dispose?(): void },
						);
					});
				});
			},
		},
	} as unknown as ExtensionContext;
}

/**
 * Runs `fn` with `PI_CODING_AGENT_DIR` pointed at a fresh temp directory, so
 * `settings.ts`'s `loadSettings()`/`saveSettings()` never touch the real
 * `~/.pi/agent` directory. Restores the previous env var afterward.
 */
async function withTempAgentDir<T>(fn: () => Promise<T> | T): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), "pi-topping-lifecycle-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		return await fn();
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
}

function assistantMessage(output = 0): Extract<MessageEndEvent["message"], { role: "assistant" }> {
	return {
		role: "assistant",
		content: [],
		api: "test",
		provider: "test",
		model: "test",
		usage: { input: 0, output, cacheRead: 0, cacheWrite: 0, totalTokens: output },
		stopReason: "stop",
		timestamp: 0,
	};
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

function mockTimers(t: test.TestContext, onTick: (tick: () => void) => void): void {
	t.mock.method(globalThis, "setInterval", ((tick: () => void) => {
		onTick(tick);
		return 1;
	}) as unknown as typeof setInterval);
	t.mock.method(globalThis, "clearInterval", (() => {}) as typeof clearInterval);
}

test("an input-less run resets the token count after settling", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("input", { type: "input", text: "first", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(500) }, ctx);
		await extension.emit("agent_settled", { type: "agent_settled" }, ctx);

		now = 10_000;
		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		assert.match(messages.at(-1)!, /\(0m 00s · ↓ 0 tokens\)/);
	});
});

test("agent_start preserves the spinner and places the activity meter after the working word", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const indicators: unknown[] = [];
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, indicators, (color, text) => `<${color}>${text}</${color}>`);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		assert.equal(indicators.length, 0);
		const message = messages[0]!;
		const meter = "<dim>⢀</dim>".repeat(8);
		assert.ok(message.indexOf(meter) > 0);
		assert.ok(message.indexOf("(0m 00s · ↓ 0 tokens)") > message.indexOf(meter));
	});
});

test("tracks streamed tokens, usage reconciliation, tool words, and settlement", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const indicators: unknown[] = [];
		const ctx = createContext(messages, indicators);
		let tick: (() => void) | undefined;
		let now = 1_000;
		// One Math.random() call per pickRandomWord() invocation: the first (on
		// "input") picks the first word alphabetically, the second (on
		// "tool_execution_start") picks the last.
		const randomValues = [0, 0.999];
		t.mock.method(Date, "now", () => now);
		t.mock.method(Math, "random", () => randomValues.shift() ?? 0.999);
		mockTimers(t, (callback) => {
			tick = callback;
		});

		workingDecorator(extension.asAPI());
		await extension.emit("input", { type: "input", text: "prompt", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		const partial = assistantMessage();
		await extension.emit("message_start", { type: "message_start", message: partial }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hel", partial },
		}, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "lo world", partial },
		}, ctx);

		now = 1_100;
		tick!();
		assert.match(messages.at(-1)!, /↓ 2 tokens/);

		await extension.emit("message_end", { type: "message_end", message: assistantMessage(5) }, ctx);
		now = 1_200;
		tick!();
		assert.match(messages.at(-1)!, /↓ 5 tokens/);

		await extension.emit("message_start", { type: "message_start", message: partial }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "estimated", partial },
		}, ctx);
		await extension.emit("message_end", { type: "message_end", message: { ...assistantMessage(), usage: undefined } }, ctx);
		now = 1_300;
		tick!();
		assert.match(messages.at(-1)!, /↓ 6 tokens/);

		await extension.emit("tool_execution_start", {
			type: "tool_execution_start",
			toolCallId: "tool-1",
			toolName: "read",
			args: {},
		}, ctx);
		now = 1_350;
		tick!();
		assert.match(stripAnsi(messages.at(-1)!), /^Zigzagging…/);

		await extension.emit("agent_settled", { type: "agent_settled" }, ctx);
		assert.equal(messages.at(-1), undefined);
		assert.equal(indicators.at(-1), undefined);
	});
});

test("session_start clears an existing timer before resetting state", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		const cleared: unknown[] = [];
		t.mock.method(globalThis, "setInterval", (() => 42) as unknown as typeof setInterval);
		t.mock.method(globalThis, "clearInterval", ((timer: unknown) => cleared.push(timer)) as typeof clearInterval);

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		assert.deepEqual(cleared, [42]);
	});
});

test("substituteDefaultMessage=false shows a Working\u2026 placeholder but other enabled toggles still apply", async (t) => {
	await withTempAgentDir(async () => {
		// Only substituteDefaultMessage is off; elapsedTime/outputTokens/shimmer/
		// tokenActivityMonitor remain at their (enabled) defaults, so they must
		// still show up even though the random activity word is replaced by a
		// plain "Working\u2026" placeholder.
		saveSettings({
			...DEFAULT_SETTINGS,
			features: { ...DEFAULT_SETTINGS.features, substituteDefaultMessage: false },
		});

		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		assert.equal(messages.length, 1);
		const message = messages[0]!;
		assert.match(stripAnsi(message), /^Working\u2026/);
		assert.match(message, /\(0m 00s \u00b7 \u2193 0 tokens\)/);
	});
});

test("fully-default settings (nothing customized) restore pi's untouched default message", async (t) => {
	await withTempAgentDir(async () => {
		// Every toggle that could alter the message's appearance is off, so tick()
		// should fully restore pi's default instead of building a lookalike.
		saveSettings({
			decorations: {
				...DEFAULT_SETTINGS.decorations,
				shimmer: false,
				tokenActivityMonitor: false,
			},
			features: {
				...DEFAULT_SETTINGS.features,
				substituteDefaultMessage: false,
				elapsedTime: false,
				outputTokens: false,
			},
		});

		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		assert.equal(messages.length, 1);
		assert.equal(messages[0], undefined);
	});
});

test("animatedSpinner=false hides the spinner via empty frames and stays hidden across settle", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			decorations: { ...DEFAULT_SETTINGS.decorations, animatedSpinner: false },
		});

		const extension = new MockExtension();
		const indicators: unknown[] = [];
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, indicators);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		assert.deepEqual(indicators.at(-1), { frames: [] });

		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("agent_settled", { type: "agent_settled" }, ctx);
		assert.deepEqual(indicators.at(-1), { frames: [] });
	});
});

test("animatedSpinner=true (default) never hides the spinner with empty frames", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const indicators: unknown[] = [];
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, indicators);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("agent_settled", { type: "agent_settled" }, ctx);

		assert.ok(!indicators.some((i) => JSON.stringify(i) === JSON.stringify({ frames: [] })));
	});
});

test("elapsedTime and outputTokens both off omit the parenthesized detail entirely", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			features: { ...DEFAULT_SETTINGS.features, elapsedTime: false, outputTokens: false },
		});

		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		const message = messages.at(-1)!;
		assert.ok(!message.includes("("));
		assert.ok(!message.includes(")"));
	});
});

test("elapsedTime off but outputTokens on shows only the token count with no dangling separator", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			features: { ...DEFAULT_SETTINGS.features, elapsedTime: false },
		});

		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		const message = messages.at(-1)!;
		assert.match(message, /\(\u2193 0 tokens\)/);
		assert.ok(!message.includes("m 00s"));
		assert.ok(!message.includes(" \u00b7 "));
	});
});

test("/topping-settings requires TUI mode and notifies otherwise", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const notifications: { message: string; type?: string }[] = [];
		const ctx = createContext([], [], (_color, text) => text, { mode: "print", notifications }) as unknown as ExtensionCommandContext;

		workingDecorator(extension.asAPI());
		const command = extension.commands["topping-settings"];
		assert.ok(command, "expected /topping-settings to be registered");

		await command!.handler("", ctx);

		assert.equal(notifications.length, 1);
		assert.equal(notifications[0]!.type, "error");
		assert.match(notifications[0]!.message, /TUI mode/);
	});
});

test("/topping-settings wires a live preview into the menu that reflects toggles", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		let capturedComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		t.mock.method(Math, "random", () => 0);
		let previewTick: (() => void) | undefined;
		mockTimers(t, (cb) => {
			previewTick = cb;
		});

		const ctx = createContext([], [], (_color, text) => text, {
			mode: "tui",
			onCustomComponent: (c) => {
				capturedComponent = c;
			},
		}) as unknown as ExtensionCommandContext;

		workingDecorator(extension.asAPI());
		const command = extension.commands["topping-settings"];
		assert.ok(command, "expected /topping-settings to be registered");

		const handlerPromise = command!.handler("", ctx);

		// Let the mocked ctx.ui.custom()'s factory-resolution microtask run.
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(capturedComponent, "expected the menu component to be captured");

		const initial = capturedComponent!.render(72).map(stripAnsi);
		assert.ok(initial.some((l) => l.includes("Preview")));
		// Math.random mocked to 0, so the simulated preview word is WORDS[0].present_tense.
		assert.ok(initial.some((l) => l.includes("Accomplishing\u2026")));
		// Default settings: animatedSpinner is on, so the simulated spinner glyph shows.
		assert.ok(initial.some((l) => l.includes("\u280b")));

		// Advance the simulated clock and drive one preview animation tick; the
		// preview should keep reflecting the same simulated word.
		now += 200;
		previewTick?.();
		const animated = capturedComponent!.render(72).map(stripAnsi);
		assert.ok(animated.some((l) => l.includes("Accomplishing\u2026")));

		// Close the menu (Escape = cancel) so the command handler resolves and
		// the preview animation timer is disposed via component.dispose().
		capturedComponent!.handleInput!("\x1b");
		await handlerPromise;
	});
});

test("/topping-settings persists toggled values to settings.json on apply", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		let capturedComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
		t.mock.method(Date, "now", () => 1_000);
		t.mock.method(Math, "random", () => 0);
		mockTimers(t, () => {});

		const ctx = createContext([], [], (_color, text) => text, {
			mode: "tui",
			onCustomComponent: (c) => {
				capturedComponent = c;
			},
		}) as unknown as ExtensionCommandContext;

		workingDecorator(extension.asAPI());
		const command = extension.commands["topping-settings"];
		assert.ok(command, "expected /topping-settings to be registered");

		const handlerPromise = command!.handler("", ctx);
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(capturedComponent, "expected the menu component to be captured");

		// Cursor starts on "animatedSpinner" (first item, first section). Toggle
		// it off, then move down to "shimmer" and toggle it off too.
		capturedComponent!.handleInput!(" ");
		capturedComponent!.handleInput!("\x1b[B");
		capturedComponent!.handleInput!(" ");

		// Apply.
		capturedComponent!.handleInput!("\r");
		await handlerPromise;

		const persisted = loadSettings();
		assert.equal(persisted.decorations.animatedSpinner, false);
		assert.equal(persisted.decorations.shimmer, false);
		// Untouched toggles keep their defaults.
		assert.equal(persisted.decorations.tokenActivityMonitor, true);
		assert.equal(persisted.features.substituteDefaultMessage, true);
		assert.equal(persisted.features.elapsedTime, true);
		assert.equal(persisted.features.outputTokens, true);
	});
});

test("/topping-settings persists all seven toggles flipped in one pass", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		let capturedComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
		t.mock.method(Date, "now", () => 1_000);
		t.mock.method(Math, "random", () => 0);
		mockTimers(t, () => {});

		const ctx = createContext([], [], (_color, text) => text, {
			mode: "tui",
			onCustomComponent: (c) => {
				capturedComponent = c;
			},
		}) as unknown as ExtensionCommandContext;

		workingDecorator(extension.asAPI());
		const command = extension.commands["topping-settings"];
		assert.ok(command, "expected /topping-settings to be registered");

		const handlerPromise = command!.handler("", ctx);
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(capturedComponent, "expected the menu component to be captured");

		// Cursor order (flattened across both sections): animatedSpinner,
		// shimmer, tokenActivityMonitor, substituteDefaultMessage, elapsedTime,
		// outputTokens, doneMarker. Toggle every item, moving down between each.
		capturedComponent!.handleInput!(" ");
		for (let i = 0; i < 6; i++) {
			capturedComponent!.handleInput!("\x1b[B");
			capturedComponent!.handleInput!(" ");
		}

		// Apply.
		capturedComponent!.handleInput!("\r");
		await handlerPromise;

		const persisted = loadSettings();
		assert.equal(persisted.decorations.animatedSpinner, !DEFAULT_SETTINGS.decorations.animatedSpinner);
		assert.equal(persisted.decorations.shimmer, !DEFAULT_SETTINGS.decorations.shimmer);
		assert.equal(persisted.decorations.tokenActivityMonitor, !DEFAULT_SETTINGS.decorations.tokenActivityMonitor);
		assert.equal(
			persisted.features.substituteDefaultMessage,
			!DEFAULT_SETTINGS.features.substituteDefaultMessage,
		);
		assert.equal(persisted.features.elapsedTime, !DEFAULT_SETTINGS.features.elapsedTime);
		assert.equal(persisted.features.outputTokens, !DEFAULT_SETTINGS.features.outputTokens);
		assert.equal(persisted.features.doneMarker, !DEFAULT_SETTINGS.features.doneMarker);
	});
});

test("preview reflects the substituteDefaultMessage fix: toggling it off keeps elapsed/token details", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		let capturedComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
		const now = 1_000;
		t.mock.method(Date, "now", () => now);
		t.mock.method(Math, "random", () => 0);
		mockTimers(t, () => {});

		const ctx = createContext([], [], (_color, text) => text, {
			mode: "tui",
			onCustomComponent: (c) => {
				capturedComponent = c;
			},
		}) as unknown as ExtensionCommandContext;

		workingDecorator(extension.asAPI());
		const command = extension.commands["topping-settings"];
		assert.ok(command, "expected /topping-settings to be registered");

		const handlerPromise = command!.handler("", ctx);
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(capturedComponent, "expected the menu component to be captured");

		// Flat cursor order: [0] animatedSpinner, [1] shimmer, [2] tokenActivityMonitor,
		// [3] substituteDefaultMessage, [4] elapsedTime, [5] outputTokens.
		capturedComponent!.handleInput!("\x1b[B"); // down x3 -> substituteDefaultMessage
		capturedComponent!.handleInput!("\x1b[B");
		capturedComponent!.handleInput!("\x1b[B");
		capturedComponent!.handleInput!(" "); // space: toggle substituteDefaultMessage off

		const lines = capturedComponent!.render(72).map(stripAnsi);
		// The random activity word is replaced by the plain placeholder...
		assert.ok(lines.some((l) => l.includes("Working\u2026")));
		assert.ok(!lines.some((l) => l.includes("Accomplishing\u2026")));
		// ...but elapsed time and output tokens (still on) keep showing.
		assert.ok(lines.some((l) => l.includes("(0m 00s \u00b7 \u2193 0 tokens)")));

		capturedComponent!.handleInput!("\x1b"); // escape: cancel
		await handlerPromise;
	});
});

test("preview's simulated activity meter visibly animates (oscillates) rather than flatlining", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		let capturedComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
		let now = 0;
		t.mock.method(Date, "now", () => now);
		t.mock.method(Math, "random", () => 0);
		let previewTick: (() => void) | undefined;
		mockTimers(t, (cb) => {
			previewTick = cb;
		});

		const ctx = createContext([], [], (_color, text) => text, {
			mode: "tui",
			onCustomComponent: (c) => {
				capturedComponent = c;
			},
		}) as unknown as ExtensionCommandContext;

		workingDecorator(extension.asAPI());
		const command = extension.commands["topping-settings"];
		assert.ok(command, "expected /topping-settings to be registered");

		const handlerPromise = command!.handler("", ctx);
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(capturedComponent, "expected the menu component to be captured");

		const meterRegex = /[\u2880\u28c0\u28e0\u28e4\u28f4\u28f6\u28fe\u28ff]{8}/;
		function meterAt(elapsedMs: number): string {
			now = elapsedMs;
			previewTick?.();
			const line = capturedComponent!.render(72).map(stripAnsi).join("\n");
			const match = line.match(meterRegex);
			assert.ok(match, `expected a meter run of 8 braille cells in: ${JSON.stringify(line)}`);
			return match![0];
		}

		const idle = meterAt(0);
		const midCycle = meterAt(600); // quarter of the 2400ms breathing period: rising
		const peak = meterAt(1200); // half period: near peak
		const fallingBack = meterAt(2400); // full period: back near idle

		// The meter must actually change over time (not hold one static frame)...
		assert.notEqual(idle, midCycle);
		assert.notEqual(midCycle, peak);
		// ...and it oscillates back down rather than monotonically increasing forever.
		assert.notEqual(peak, fallingBack);

		capturedComponent!.handleInput!("\x1b"); // escape: cancel
		await handlerPromise;
	});
});

test("agent_settled appends a pi-topping-done entry with the past-tense word and elapsed duration", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		t.mock.method(Math, "random", () => 0.999);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("input", { type: "input", text: "prompt", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		now = 1_000 + 6 * 60_000 + 41_000; // 6m 41s later
		await extension.emit("agent_settled", { type: "agent_settled" }, ctx);

		assert.equal(extension.appendedEntries.length, 1);
		const entry = extension.appendedEntries[0]!;
		assert.equal(entry.customType, "pi-topping-done");
		const data = entry.data as { word: string; elapsedMs: number };
		assert.equal(data.word, "Zigzagged");
		assert.equal(data.elapsedMs, 6 * 60_000 + 41_000);
	});
});

test("agent_settled does not append a completion marker when doneMarker is disabled", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			features: { ...DEFAULT_SETTINGS.features, doneMarker: false },
		});

		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("input", { type: "input", text: "prompt", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("agent_settled", { type: "agent_settled" }, ctx);

		assert.equal(extension.appendedEntries.length, 0);
	});
});

test("agent_settled without a preceding prompt start does not append a completion marker", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		// No "input"/"agent_start" emitted first, so state.startTime is still 0.
		await extension.emit("agent_settled", { type: "agent_settled" }, ctx);

		assert.equal(extension.appendedEntries.length, 0);
	});
});

test("the pi-topping-done entry renderer renders the word/time in dim text and π in the text color", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		const renderer = extension.entryRenderers["pi-topping-done"];
		assert.ok(renderer, "expected a pi-topping-done entry renderer to be registered");

		const component = renderer(
			{ type: "custom", customType: "pi-topping-done", data: { word: "Baked", elapsedMs: 6 * 60_000 + 41_000 } },
			{ expanded: false },
			ctx.ui.theme,
		) as { render(width: number): string[] };
		assert.ok(component, "expected the renderer to return a component");

		const lines = component.render(80);
		const text = lines.join("\n");
		assert.match(text, /<text>\u03c0<\/text>/);
		assert.match(text, /<dim> Baked for 6m 41s<\/dim>/);
	});
});
