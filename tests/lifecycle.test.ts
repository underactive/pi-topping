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
import { PROMPT_BOX_TYPE } from "../src/prompt-decorator.ts";
import { buildMenuSections, DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/settings.ts";
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
type Handler<K extends TestedEventName> = (event: TestedEvents[K], ctx: ExtensionContext) => Promise<unknown> | unknown;
type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type RegisteredCommandLike = { description?: string; handler: CommandHandler };

class MockExtension {
	readonly handlers: Partial<{ [K in TestedEventName]: Handler<K> }> = {};
	readonly commands: Record<string, RegisteredCommandLike> = {};
	readonly appendedEntries: { customType: string; data: unknown }[] = [];
	readonly entryRenderers: Record<string, (entry: unknown, options: unknown, theme: unknown) => unknown> = {};
	readonly messageRenderers: Record<string, (message: unknown, options: unknown, theme: unknown) => unknown> = {};
	readonly sentMessages: { message: unknown; options: unknown }[] = [];

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

	registerMessageRenderer(customType: string, renderer: (message: unknown, options: unknown, theme: unknown) => unknown): void {
		this.messageRenderers[customType] = renderer;
	}

	sendMessage(message: unknown, options: unknown): void {
		this.sentMessages.push({ message, options });
	}

	async emit<K extends TestedEventName>(name: K, event: TestedEvents[K], ctx: ExtensionContext): Promise<unknown> {
		const handler = this.handlers[name] as Handler<K> | undefined;
		if (!handler) throw new Error(`No handler registered for ${name}`);
		return await handler(event, ctx);
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
	const theme = {
		fg,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		getFgAnsi: (color: string) => color === "dim" ? "\x1b[38;2;96;96;96m" : "\x1b[38;2;224;224;224m",
	};
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

function moveMenuCursor(component: { handleInput?(data: string): void }, fromId: string, toId: string): void {
	const ids = buildMenuSections(DEFAULT_SETTINGS).flatMap((section) => section.items.map((item) => item.id));
	const fromIndex = ids.indexOf(fromId);
	const toIndex = ids.indexOf(toId);
	assert.ok(fromIndex >= 0, `unknown menu item: ${fromId}`);
	assert.ok(toIndex >= fromIndex, `menu helper only moves down: ${fromId} -> ${toId}`);
	for (let index = fromIndex; index < toIndex; index++) component.handleInput!("\x1b[B");
}

function mockTimers(t: test.TestContext, onTick: (tick: () => void) => void): void {
	t.mock.method(globalThis, "setInterval", ((tick: () => void) => {
		onTick(tick);
		return 1;
	}) as unknown as typeof setInterval);
	t.mock.method(globalThis, "clearInterval", (() => {}) as typeof clearInterval);
	t.mock.method(globalThis, "setTimeout", ((tick: () => void) => {
		onTick(tick);
		return 1;
	}) as unknown as typeof setTimeout);
	t.mock.method(globalThis, "clearTimeout", (() => {}) as typeof clearTimeout);
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

		assert.match(messages.at(-1)!, /--- tok\/s · 0s · ↓ 0 tokens/);
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
		assert.ok(message.indexOf("<dim>0s</dim>") > message.indexOf(meter));
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

test("live token rate is warning styled and rounded in the default detail group", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], (color, text) => `<${color}>${text}</${color}>`);
		let tick: (() => void) | undefined;
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		mockTimers(t, (callback) => {
			tick = callback;
		});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		assert.match(messages.at(-1)!, /<dim>--- tok\/s<\/dim>/, "an inactive rate should use the dim placeholder");
		assert.ok(!messages.at(-1)!.includes("<warning></warning>"), "empty rates must not be styled");

		const partial = assistantMessage();
		await extension.emit("message_start", { type: "message_start", message: partial }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "one two", partial },
		}, ctx);
		now = 1_100;
		tick!();

		assert.match(messages.at(-1)!, /<warning>  8 tok\/s<\/warning>/);
	});
});

test("token rate uses the configured theme color", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, decorations: { ...DEFAULT_SETTINGS.decorations, tokenRateColor: "success" } });
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], (color, text) => `<${color}>${text}</${color}>`);
		let tick: (() => void) | undefined;
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		mockTimers(t, (callback) => {
			tick = callback;
		});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		const partial = assistantMessage();
		await extension.emit("message_start", { type: "message_start", message: partial }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "one two", partial },
		}, ctx);
		now = 1_100;
		tick!();

		assert.match(messages.at(-1)!, /<success>  8 tok\/s<\/success>/);
	});
});

test("dimmed token rate wraps the warning styling in the terminal dim attribute", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, decorations: { ...DEFAULT_SETTINGS.decorations, tokenRateDimmed: true } });
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], (color, text) => `<${color}>${text}</${color}>`);
		let tick: (() => void) | undefined;
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		mockTimers(t, (callback) => {
			tick = callback;
		});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		const partial = assistantMessage();
		await extension.emit("message_start", { type: "message_start", message: partial }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "one two", partial },
		}, ctx);
		now = 1_100;
		tick!();

		assert.match(messages.at(-1)!, /\x1b\[2m<warning>  8 tok\/s<\/warning>\x1b\[22m/);
	});
});

test("token rate holds, fades, and resets to full brightness on updates", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], (color, text) => `<${color}>${text}</${color}>`);
		let tick: (() => void) | undefined;
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		mockTimers(t, (callback) => {
			tick = callback;
		});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		const first = assistantMessage();
		await extension.emit("message_start", { type: "message_start", message: first }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: first,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "one two", partial: first },
		}, ctx);
		now = 1_100;
		tick!();
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(2) }, ctx);

		now = 1_350;
		tick!();
		assert.match(messages.at(-1)!, /<warning>  8 tok\/s<\/warning>/);

		const second = assistantMessage();
		await extension.emit("message_start", { type: "message_start", message: second }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: second,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "one two three four five", partial: second },
		}, ctx);
		now = 1_450;
		tick!();
		assert.match(messages.at(-1)!, /<warning> 20 tok\/s<\/warning>/);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(5) }, ctx);

		now = 2_949;
		tick!();
		assert.match(messages.at(-1)!, /<warning> 20 tok\/s<\/warning>/);
		now = 2_950;
		tick!();
		assert.match(messages.at(-1)!, /\x1b\[38;2;212;212;212m 20 tok\/s\x1b\[0m/);
		now = 3_000;
		tick!();
		assert.match(messages.at(-1)!, /\x1b\[38;2;180;180;180m 20 tok\/s\x1b\[0m/);

		const third = assistantMessage();
		await extension.emit("message_start", { type: "message_start", message: third }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: third,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "one two three four five", partial: third },
		}, ctx);
		now = 3_049;
		tick!();
		assert.match(messages.at(-1)!, /<warning> 20 tok\/s<\/warning>/);

		now = 4_549;
		tick!();
		assert.match(messages.at(-1)!, /\x1b\[38;2;212;212;212m 20 tok\/s\x1b\[0m/);
		now = 4_798;
		tick!();
		assert.match(messages.at(-1)!, /\x1b\[38;2;96;96;96m 20 tok\/s\x1b\[0m/);
		now = 4_799;
		tick!();
		assert.match(messages.at(-1)!, /<dim>--- tok\/s<\/dim>/);
	});
});

test("disabled token rate omits the throughput segment", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, tokenRate: false } });
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], (color, text) => `<${color}>${text}</${color}>`);
		let tick: (() => void) | undefined;
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		mockTimers(t, (callback) => {
			tick = callback;
		});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		const partial = assistantMessage();
		await extension.emit("message_start", { type: "message_start", message: partial }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "one two", partial },
		}, ctx);
		now = 1_100;
		tick!();

		assert.ok(!messages.at(-1)!.includes("tok/s"));
	});
});

test("token rate keeps a 100ms timer and updates without the activity meter", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			decorations: { ...DEFAULT_SETTINGS.decorations, shimmer: false, tokenActivityMonitor: false },
			features: { ...DEFAULT_SETTINGS.features, elapsedTime: false, outputTokens: false },
		});
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], (color, text) => `<${color}>${text}</${color}>`);
		let tick: (() => void) | undefined;
		const intervals: number[] = [];
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		t.mock.method(globalThis, "setInterval", ((callback: () => void, delay: number) => {
			tick = callback;
			intervals.push(delay);
			return 1;
		}) as unknown as typeof setInterval);
		t.mock.method(globalThis, "clearInterval", (() => {}) as typeof clearInterval);

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		assert.deepEqual(intervals, [100]);

		const partial = assistantMessage();
		await extension.emit("message_start", { type: "message_start", message: partial }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "one two", partial },
		}, ctx);
		now = 1_100;
		tick!();

		assert.match(messages.at(-1)!, /<warning>  8 tok\/s<\/warning>/);
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
		assert.match(message, /--- tok\/s \u00b7 0s \u00b7 \u2193 0 tokens/);
	});
});

test("inverted shimmer keeps the working text bright with a dimmed gradient", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			decorations: { ...DEFAULT_SETTINGS.decorations, shimmerInverted: true, tokenActivityMonitor: false },
			features: { ...DEFAULT_SETTINGS.features, elapsedTime: false, outputTokens: false, tokenRate: false },
		});

		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		let now = 1;
		let tick: (() => void) | undefined;
		t.mock.method(Date, "now", () => now);
		t.mock.method(Math, "random", () => 0);
		mockTimers(t, (callback) => {
			tick = callback;
		});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		now = 501;
		assert.ok(tick, "expected the shimmer timer to be registered");
		tick!();

		const message = messages.at(-1)!;
		const colors = [...message.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map((match) => match.slice(1).join(","));
		assert.ok(colors.includes("224,224,224"), "expected the resting text color");
		assert.ok(new Set(colors).size > 1, "expected a dimmed gradient across the shimmer");
		assert.ok(colors.some((color) => Number(color.split(",")[0]) < 224), "expected the shimmer to dim the text");
		assert.doesNotMatch(message, /\x1b\[1m/);
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
				tokenRate: false,
			},
			loaderOrder: [...DEFAULT_SETTINGS.loaderOrder],
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

test("loaderOrder reorders the message and moves the spinner inline when it is not first", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			decorations: { ...DEFAULT_SETTINGS.decorations, shimmer: false, tokenActivityMonitor: false },
			features: { ...DEFAULT_SETTINGS.features, substituteDefaultMessage: false },
			loaderOrder: ["elapsed", "text", "spinner", "tokens"],
		});

		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const indicators: unknown[] = [];
		const ctx = createContext(messages, indicators);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		// Pi's Loader would otherwise force the spinner back to the front.
		assert.deepEqual(indicators.at(-1), { frames: [] });

		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		// "meter" was missing from the persisted order and is appended at the end,
		// but the monitor is off so it contributes nothing.
		assert.match(
			stripAnsi(messages.at(-1)!),
			/^0s Working\u2026 [\u280b\u2819\u2839\u2838\u283c\u2834\u2826\u2827\u2807\u280f] \u2193 0 tokens \u00b7 --- tok\/s$/,
		);
	});
});

test("a reordered spinner still animates when nothing else is customized", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			decorations: { ...DEFAULT_SETTINGS.decorations, shimmer: false, tokenActivityMonitor: false },
			features: { ...DEFAULT_SETTINGS.features, substituteDefaultMessage: false, elapsedTime: false, outputTokens: false, tokenRate: false },
			loaderOrder: ["text", "spinner", "meter", "elapsed", "tokens", "tokenRate"],
		});

		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		let now = 1_000;
		let tick: (() => void) | undefined;
		const intervals: number[] = [];
		t.mock.method(Date, "now", () => now);
		t.mock.method(globalThis, "setInterval", ((callback: () => void, delay: number) => {
			tick = callback;
			intervals.push(delay);
			return 1;
		}) as unknown as typeof setInterval);
		t.mock.method(globalThis, "clearInterval", (() => {}) as typeof clearInterval);

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		// Every appearance toggle is off, but the message can no longer be handed
		// back to pi: it has to carry the spinner, so it ticks at frame rate.
		assert.deepEqual(intervals, [80]);
		const first = stripAnsi(messages.at(-1)!);
		assert.match(first, /^Working\u2026 [\u280b\u2819\u2839\u2838\u283c\u2834\u2826\u2827\u2807\u280f]$/);

		now += 80;
		tick!();
		assert.notEqual(stripAnsi(messages.at(-1)!), first);
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

test("elapsedTime and outputTokens both off omit the detail group entirely", async (t) => {
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

test("elapsedTime off but outputTokens on joins the token count with the token rate", async (t) => {
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
		assert.match(message, /--- tok\/s \u00b7 \u2193 0 tokens/);
		assert.ok(!message.includes("m 00s"));
		assert.ok(!message.includes("("));
		assert.ok(!message.includes(")"));
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
		ctx.model = { provider: "preview", id: "model" } as NonNullable<ExtensionContext["model"]>;

		workingDecorator(extension.asAPI());
		const command = extension.commands["topping-settings"];
		assert.ok(command, "expected /topping-settings to be registered");

		const handlerPromise = command!.handler("", ctx);

		// Let the mocked ctx.ui.custom()'s factory-resolution microtask run.
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(capturedComponent, "expected the menu component to be captured");

		const initial = capturedComponent!.render(76).map(stripAnsi);
		assert.ok(initial.some((l) => l.includes("Preview")));
		// The initial selection is in User Prompt, so only its contextual preview is shown.
		assert.ok(initial.some((l) => l.includes("ping")));
		assert.ok(initial.some((l) => l.includes("")));
		assert.ok(initial.some((l) => l.includes("preview/model")));

		// Toggle the provider off to preview a model-only label, then move to “Working” Loader.
		moveMenuCursor(capturedComponent!, "decorateUserPrompt", "promptProvider");
		capturedComponent!.handleInput!(" ");
		const withoutProvider = capturedComponent!.render(76).map(stripAnsi);
		assert.ok(withoutProvider.some((l) => l.includes(" model ═")));
		assert.ok(!withoutProvider.some((l) => l.includes("preview/")));
		moveMenuCursor(capturedComponent!, "promptProvider", "animatedSpinner");

		// Moving to “Working” Loader swaps the preview to its animated example.
		now += 1_000;
		previewTick?.();
		const animatedRaw = capturedComponent!.render(76);
		const animated = animatedRaw.map(stripAnsi);
		assert.ok(animated.some((l) => l.includes("Accomplishing\u2026")));
		assert.ok(animated.some((l) => l.includes(" 28 tok/s")));
		const normalShimmer = animatedRaw.find((l) => stripAnsi(l).includes("Accomplishing\u2026"))!;
		assert.match(normalShimmer, /\x1b\[1m/);

		// Inverting the shimmer keeps the resting text bright, then sweeps a dimmed gradient without bolding it.
		moveMenuCursor(capturedComponent!, "animatedSpinner", "shimmerInverted");
		capturedComponent!.handleInput!(" ");
		const invertedRaw = capturedComponent!.render(76);
		const invertedShimmer = invertedRaw.find((l) => stripAnsi(l).includes("Accomplishing\u2026"))!;
		assert.doesNotMatch(invertedShimmer, /\x1b\[1m/);
		assert.match(invertedShimmer, /\x1b\[38;2;224;224;224m/);
		const invertedColors = [...invertedShimmer.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map((match) => Number(match[1]));
		assert.ok(invertedColors.some((red) => red < 224), "expected the shimmer to dim the text");

		// Toggling Token rate updates the preview immediately.
		moveMenuCursor(capturedComponent!, "shimmerInverted", "showTokenRate");
		capturedComponent!.handleInput!(" ");
		const withoutTokenRate = capturedComponent!.render(76).map(stripAnsi);
		assert.ok(!withoutTokenRate.some((l) => l.includes("tok/s")));

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

		// Move from User Prompt to the “Working” Loader controls, then toggle
		// animated spinner and text shimmer off.
		moveMenuCursor(capturedComponent!, "decorateUserPrompt", "animatedSpinner");
		capturedComponent!.handleInput!(" ");
		moveMenuCursor(capturedComponent!, "animatedSpinner", "shimmer");
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

test("/topping-settings persists every menu control flipped in one pass", async (t) => {
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

		// Toggle every current menu item, moving down between each. Walking the
		// real menu rows prevents this integration test from silently skipping a
		// newly added control. Reorder rows are stepped over rather than pressed:
		// space would grab one, and the following downs would sort it instead of
		// advancing the cursor.
		const rows = buildMenuSections(DEFAULT_SETTINGS).flatMap((section) => section.items);
		for (const [index, row] of rows.entries()) {
			if (index > 0) capturedComponent!.handleInput!("\x1b[B");
			if (!row.reorderGroup) capturedComponent!.handleInput!(" ");
		}

		// Apply.
		capturedComponent!.handleInput!("\r");
		await handlerPromise;

		const persisted = loadSettings();
		assert.equal(persisted.decorations.decorateUserPrompt, !DEFAULT_SETTINGS.decorations.decorateUserPrompt);
		assert.equal(persisted.decorations.borderColorEnabled, false);
		assert.equal(persisted.decorations.borderColor, "border");
		assert.equal(persisted.decorations.borderStyleEnabled, false);
		assert.equal(persisted.decorations.borderStyle, "double");
		assert.equal(persisted.decorations.promptIcon, !DEFAULT_SETTINGS.decorations.promptIcon);
		assert.equal(persisted.decorations.promptTimestamp, !DEFAULT_SETTINGS.decorations.promptTimestamp);
		assert.equal(persisted.decorations.promptProvider, !DEFAULT_SETTINGS.decorations.promptProvider);
		assert.equal(persisted.decorations.promptModel, !DEFAULT_SETTINGS.decorations.promptModel);
		assert.equal(persisted.decorations.animatedSpinner, !DEFAULT_SETTINGS.decorations.animatedSpinner);
		assert.equal(persisted.decorations.spinnerColorEnabled, false);
		assert.equal(persisted.decorations.spinnerColor, "accent");
		assert.equal(
			persisted.features.substituteDefaultMessage,
			!DEFAULT_SETTINGS.features.substituteDefaultMessage,
		);
		assert.equal(persisted.decorations.shimmer, !DEFAULT_SETTINGS.decorations.shimmer);
		assert.equal(persisted.decorations.shimmerInverted, !DEFAULT_SETTINGS.decorations.shimmerInverted);
		assert.equal(persisted.decorations.shimmerDirectionEnabled, false);
		assert.equal(persisted.decorations.shimmerDirection, "ltr");
		assert.equal(persisted.decorations.shimmerSpeedEnabled, false);
		assert.equal(persisted.decorations.shimmerSpeed, "normal");
		assert.equal(persisted.decorations.tokenActivityMonitor, !DEFAULT_SETTINGS.decorations.tokenActivityMonitor);
		assert.equal(persisted.decorations.meterColorEnabled, false);
		assert.equal(persisted.decorations.meterColor, "accent");
		assert.equal(persisted.decorations.meterDirectionEnabled, false);
		assert.equal(persisted.decorations.meterDirection, "rtl");
		assert.equal(persisted.decorations.meterDimmed, !DEFAULT_SETTINGS.decorations.meterDimmed);
		assert.equal(persisted.features.elapsedTime, !DEFAULT_SETTINGS.features.elapsedTime);
		assert.equal(persisted.features.outputTokens, !DEFAULT_SETTINGS.features.outputTokens);
		assert.equal(persisted.features.tokenRate, !DEFAULT_SETTINGS.features.tokenRate);
		assert.equal(persisted.decorations.tokenRateColor, DEFAULT_SETTINGS.decorations.tokenRateColor);
		assert.equal(persisted.decorations.tokenRateDimmed, !DEFAULT_SETTINGS.decorations.tokenRateDimmed);
		assert.equal(persisted.features.doneMarker, !DEFAULT_SETTINGS.features.doneMarker);
		assert.equal(persisted.features.doneMarkerIcon, !DEFAULT_SETTINGS.features.doneMarkerIcon);
		assert.equal(persisted.features.randomizeDoneMarker, !DEFAULT_SETTINGS.features.randomizeDoneMarker);
		assert.equal(persisted.features.doneMarkerTokens, !DEFAULT_SETTINGS.features.doneMarkerTokens);
		assert.equal(persisted.features.doneMarkerInputs, !DEFAULT_SETTINGS.features.doneMarkerInputs);
		assert.equal(persisted.decorations.useNerdFont, !DEFAULT_SETTINGS.decorations.useNerdFont);
	});
});

test("grabbing an Elements Order row reorders the preview and persists the new order", async (t) => {
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
		const handlerPromise = extension.commands["topping-settings"]!.handler("", ctx);
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(capturedComponent, "expected the menu component to be captured");

		const rows = buildMenuSections(DEFAULT_SETTINGS).flatMap((section) => section.items);
		const firstReorderRow = rows.findIndex((row) => row.reorderGroup);
		for (let i = 0; i < firstReorderRow; i++) capturedComponent!.handleInput!("\x1b[B");

		function previewLine(): string {
			return capturedComponent!.render(72).map(stripAnsi).find((l) => l.includes("Accomplishing\u2026"))!;
		}

		const before = previewLine();
		assert.ok(before.indexOf("\u280b") < before.indexOf("Accomplishing\u2026"), `expected a leading spinner: ${JSON.stringify(before)}`);

		capturedComponent!.handleInput!(" "); // grab the spinner row
		capturedComponent!.handleInput!("\x1b[B"); // slide it past the working text
		const after = previewLine();
		assert.ok(after.indexOf("\u280b") > after.indexOf("Accomplishing\u2026"), `expected the spinner to follow the word: ${JSON.stringify(after)}`);

		capturedComponent!.handleInput!("\r");
		await handlerPromise;

		assert.deepEqual(loadSettings().loaderOrder, ["text", "spinner", "meter", "tokenRate", "elapsed", "tokens"]);
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

		moveMenuCursor(capturedComponent!, "decorateUserPrompt", "substituteDefaultMessage");
		capturedComponent!.handleInput!(" "); // space: toggle substituteDefaultMessage off

		const lines = capturedComponent!.render(72).map(stripAnsi);
		// The random activity word is replaced by the plain placeholder...
		assert.ok(lines.some((l) => l.includes("Working\u2026")));
		assert.ok(!lines.some((l) => l.includes("Accomplishing\u2026")));
		// ...but elapsed time and output tokens (still on) keep showing.
		assert.ok(lines.some((l) => l.includes(" 28 tok/s \u00b7 0s \u00b7 \u2193 0 tokens")));

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

		// Switch from the User Prompt preview to “Working” Loader.
		moveMenuCursor(capturedComponent!, "decorateUserPrompt", "animatedSpinner");
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

test("normal interactive input is re-sent as a decorated custom message", async () => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		ctx.model = { provider: "anthropic", id: "claude-sonnet-4-5" } as NonNullable<ExtensionContext["model"]>;
		workingDecorator(extension.asAPI());

		const result = await extension.emit("input", { type: "input", text: "decorate this", source: "interactive" }, ctx);

		assert.deepEqual(result, { action: "handled" });
		assert.equal(extension.sentMessages.length, 1);
		const sent = extension.sentMessages[0] as {
			message: { customType: string; content: string; display: boolean; details: { submittedAt: number; showProvider?: boolean; showModel?: boolean; provider?: string; model?: string } };
			options: { triggerTurn: boolean };
		};
		assert.equal(sent.message.customType, PROMPT_BOX_TYPE);
		assert.equal(sent.message.content, "decorate this");
		assert.equal(sent.message.display, true);
		assert.equal(typeof sent.message.details.submittedAt, "number");
		assert.equal(sent.message.details.provider, "anthropic");
		assert.equal(sent.message.details.model, "claude-sonnet-4-5");
		assert.equal(sent.message.details.showProvider, true);
		assert.equal(sent.message.details.showModel, true);
		assert.deepEqual(sent.options, { triggerTurn: true });
	});
});

test("decorated streaming input preserves its delivery behavior", async () => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		workingDecorator(extension.asAPI());

		for (const streamingBehavior of ["steer", "followUp"] as const) {
			const result = await extension.emit(
				"input",
				{ type: "input", text: streamingBehavior, source: "interactive", streamingBehavior },
				ctx,
			);

			assert.deepEqual(result, { action: "handled" });
		}

		assert.deepEqual(
			extension.sentMessages.map((sent) => sent.options),
			[
				{ triggerTurn: true, deliverAs: "steer" },
				{ triggerTurn: true, deliverAs: "followUp" },
			],
		);
	});
});

test("command, extension, empty, and image input pass through undecorated", async () => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		workingDecorator(extension.asAPI());

		for (const event of [
			{ type: "input", text: "/foo", source: "interactive" },
			{ type: "input", text: "!ls", source: "interactive" },
			{ type: "input", text: "?q", source: "interactive" },
			{ type: "input", text: ":x", source: "interactive" },
			{ type: "input", text: "extension", source: "extension" },
			{ type: "input", text: "   ", source: "interactive" },
			{ type: "input", text: "image", source: "interactive", images: [{}] },
		] as InputEvent[]) {
			await extension.emit("input", event, ctx);
		}

		assert.equal(extension.sentMessages.length, 0);
	});
});

test("prompt decoration can be disabled", async () => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, decorations: { ...DEFAULT_SETTINGS.decorations, decorateUserPrompt: false } });
		const extension = new MockExtension();
		workingDecorator(extension.asAPI());

		await extension.emit("input", { type: "input", text: "plain prompt", source: "interactive" }, createContext([], []));

		assert.equal(extension.sentMessages.length, 0);
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

test("the pi-topping-done entry renderer renders the word/time in dim text and the Nerd Font icon in the text color", async (t) => {
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
		assert.match(text, /<text><\/text>/);
		assert.match(text, /<dim> Baked for 6m 41s<\/dim>/);
	});
});

test("mid-stream steer input preserves the elapsed timer and token count and is counted", async (t) => {
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
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(500) }, ctx);

		now = 20_000;
		await extension.emit("input", { type: "input", text: "change of plans", source: "interactive", streamingBehavior: "steer" }, ctx);

		now = 38_000;
		await extension.emit("agent_settled", { type: "agent_settled" }, ctx);

		assert.equal(extension.appendedEntries.length, 1);
		const data = extension.appendedEntries[0]!.data as { elapsedMs: number; tokens?: number; midTurnInputs?: number };
		assert.equal(data.elapsedMs, 37_000);
		assert.equal(data.tokens, 500);
		assert.equal(data.midTurnInputs, 1);
	});
});

test("mid-turn inputs accumulate across the working span and reset on the next idle turn", async (t) => {
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
		for (const streamingBehavior of ["steer", "steer", "followUp", "followUp"] as const) {
			await extension.emit("input", { type: "input", text: "more", source: "interactive", streamingBehavior }, ctx);
		}
		await extension.emit("agent_settled", { type: "agent_settled" }, ctx);

		now = 50_000;
		await extension.emit("input", { type: "input", text: "fresh", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		now = 51_000;
		await extension.emit("agent_settled", { type: "agent_settled" }, ctx);

		const entries = extension.appendedEntries.map((entry) => entry.data as { elapsedMs: number; midTurnInputs?: number });
		assert.equal(entries.length, 2);
		assert.equal(entries[0]!.midTurnInputs, 4);
		assert.equal(entries[1]!.midTurnInputs, 0);
		assert.equal(entries[1]!.elapsedMs, 1_000);
	});
});

test("mid-stream commands don't reset the turn and only queued user input is counted", async (t) => {
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

		now = 5_000;
		// Commands run immediately mid-stream, so the SDK gives them no streamingBehavior.
		await extension.emit("input", { type: "input", text: "/topping-settings", source: "interactive" }, ctx);
		await extension.emit("input", { type: "input", text: "from-extension", source: "extension", streamingBehavior: "steer" }, ctx);
		// A /skill: expansion is queued for the model like any other steer.
		await extension.emit("input", { type: "input", text: "/skill:review", source: "interactive", streamingBehavior: "steer" }, ctx);

		now = 10_000;
		await extension.emit("agent_settled", { type: "agent_settled" }, ctx);

		const data = extension.appendedEntries[0]!.data as { elapsedMs: number; midTurnInputs?: number };
		assert.equal(data.elapsedMs, 9_000);
		assert.equal(data.midTurnInputs, 1);
	});
});

test("the done entry renderer appends the mid-turn input count inside the parenthetical", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		const renderer = extension.entryRenderers["pi-topping-done"]!;
		const render = (data: unknown): string =>
			(renderer({ type: "custom", customType: "pi-topping-done", data }, { expanded: false }, ctx.ui.theme) as { render(width: number): string[] })
				.render(80)
				.join("\n");

		assert.match(render({ word: "Galloped", elapsedMs: 37_000, tokens: 2_700, midTurnInputs: 4 }), /<dim> Galloped for 37s \(↓ 2\.7k tokens · 4 mid-turn inputs\)<\/dim>/);
		assert.match(render({ word: "Whisked", elapsedMs: 2_000, midTurnInputs: 1 }), /<dim> Whisked for 2s \(1 mid-turn input\)<\/dim>/);
		assert.match(render({ word: "Baked", elapsedMs: 5_000, tokens: 10, midTurnInputs: 0 }), /<dim> Baked for 5s \(↓ 10 tokens\)<\/dim>/);
	});
});

test("doneMarkerInputs=false hides the mid-turn input count", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			features: { ...DEFAULT_SETTINGS.features, doneMarkerInputs: false },
		});

		const extension = new MockExtension();
		const ctx = createContext([], []);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		const renderer = extension.entryRenderers["pi-topping-done"]!;
		const component = renderer(
			{ type: "custom", customType: "pi-topping-done", data: { word: "Baked", elapsedMs: 5_000, tokens: 10, midTurnInputs: 4 } },
			{ expanded: false },
			ctx.ui.theme,
		) as { render(width: number): string[] };
		const text = component.render(80).join("\n");
		assert.match(text, /\(↓ 10 tokens\)/);
		assert.ok(!text.includes("mid-turn"));
	});
});
