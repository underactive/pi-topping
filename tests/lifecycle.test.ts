import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type {
	AgentSettledEvent,
	AgentStartEvent,
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionEvent,
	InputEvent,
	SessionShutdownEvent,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

type AssistantMessage = {
	role: "assistant";
	content: unknown[];
	api: string;
	provider: string;
	model: string;
	responseModel?: string;
	usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number };
	stopReason: string;
	timestamp: number;
};
type MessageStartEvent = { type: "message_start"; message: { role: string } | AssistantMessage };
type MessageUpdateEvent = {
	type: "message_update";
	message: { role: string };
	assistantMessageEvent: { type: "text_delta" | "thinking_delta"; contentIndex: number; delta: string; partial: AssistantMessage };
};
type MessageEndEvent = { type: "message_end"; message: AssistantMessage };
type ToolExecutionStartEvent = { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown };
type UIPromptStartEvent = Extract<ExtensionEvent, { type: "ui_prompt_start" }>;
type UIPromptEndEvent = Extract<ExtensionEvent, { type: "ui_prompt_end" }>;
type ProviderStreamEvent = Extract<ExtensionEvent, { type: "provider_stream_event" }>;
import { CHANNELS, WORKING_STATUS_SLIDE_MS } from "@underactive/pi-topping-primitives/contracts";
import {
	RESPONSE_MODEL_FADE_MS,
	RESPONSE_MODEL_HOLD_MS,
	RESPONSE_MODEL_SLIDE_FRAME_MS,
	SPINNER_FRAMES,
} from "../src/format.ts";
import { FADE_SHADE_COUNT as TOKEN_RATE_FADE_SHADE_COUNT } from "@underactive/pi-topping-primitives/activity";
import { PreviewRenderer } from "../src/preview.ts";
import { EXPLANATORY_REMINDER, EXPLANATORY_SECTION, OUTPUT_STYLE_MESSAGE_TYPE, OUTPUT_STYLE_SECTION, OUTPUT_STYLES, SIMPLIFIED_TECHNICAL_ENGLISH_REMINDER, SIMPLIFIED_TECHNICAL_ENGLISH_SECTION } from "../src/output-style.ts";
import { PROMPT_BOX_ENTRY_TYPE, PROMPT_BOX_TYPE, type PromptBoxEntryData } from "../src/prompt-decorator.ts";
import { buildMenuSections, DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/settings.ts";
import { loadBundledWordPacks } from "../src/word-packs.ts";
import { WORDS } from "../src/words.ts";
import { MIN_HOST_VERSION, SessionManager } from "../src/session.ts";
import workingDecorator from "../index.ts";

type TestedEvents = {
	input: InputEvent;
	before_agent_start: BeforeAgentStartEvent;
	agent_start: AgentStartEvent;
	agent_settled: AgentSettledEvent;
	session_start: SessionStartEvent;
	message_start: MessageStartEvent;
	message_update: MessageUpdateEvent;
	message_end: MessageEndEvent;
	provider_stream_event: ProviderStreamEvent;
	tool_execution_start: ToolExecutionStartEvent;
	ui_prompt_start: UIPromptStartEvent;
	ui_prompt_end: UIPromptEndEvent;
	session_shutdown: SessionShutdownEvent;
};
type TestedEventName = keyof TestedEvents;
type Handler<K extends TestedEventName> = (event: TestedEvents[K], ctx: ExtensionContext) => Promise<unknown> | unknown;
type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
type RegisteredCommandLike = { description?: string; handler: CommandHandler };
type RuntimeCommand = { name: string; source: "extension" | "prompt" | "skill"; sourceInfo: { path: string } };
type MockExtensionOptions = { getCommands?: () => RuntimeCommand[] };

const DEFAULT_RUNTIME_COMMANDS: RuntimeCommand[] = [
	{ name: "topping-statusline-settings", source: "extension", sourceInfo: { path: "/extensions/pi-topping-statusline/index.ts" } },
	{ name: "topping-splash-settings", source: "extension", sourceInfo: { path: "/extensions/pi-topping-splash/index.ts" } },
	{ name: "persona-audit", source: "extension", sourceInfo: { path: "/extensions/pi-topping-persona-audit/index.ts" } },
	{ name: "mf-plan", source: "extension", sourceInfo: { path: "/extensions/pi-topping-moa-fusion/index.ts" } },
];

class MockExtension {
	readonly handlers: Partial<{ [K in TestedEventName]: Handler<K> }> = {};
	readonly #getCommands: () => RuntimeCommand[];
	readonly commands: Record<string, RegisteredCommandLike> = {};
	readonly appendedEntries: { customType: string; data: unknown }[] = [];
	readonly entryRenderers: Record<string, (entry: unknown, options: unknown, theme: unknown) => unknown> = {};
	readonly messageRenderers: Record<string, (message: unknown, options: unknown, theme: unknown) => unknown> = {};
	readonly sentMessages: { message: unknown; options: unknown }[] = [];
	readonly #busHandlers = new Map<string, ((data: unknown) => void)[]>();
	/** Minimal stand-in for pi's shared extension event bus. */
	readonly events = {
		emit: (channel: string, data: unknown): void => {
			for (const handler of this.#busHandlers.get(channel) ?? []) handler(data);
		},
		on: (channel: string, handler: (data: unknown) => void): (() => void) => {
			this.#busHandlers.set(channel, [...(this.#busHandlers.get(channel) ?? []), handler]);
			return () => {};
		},
	};

	constructor(options: MockExtensionOptions = {}) {
		this.#getCommands = options.getCommands ?? (() => DEFAULT_RUNTIME_COMMANDS);
	}

	getCommands(): RuntimeCommand[] {
		return this.#getCommands();
	}

	/** 0.86.0's pi.on() returns an unsubscriber; the extension discards it. */
	on<K extends TestedEventName>(name: K, handler: Handler<K>): () => void {
		this.handlers[name] = handler as never;
		return () => {};
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

function agentSettledEvent(aborted = false): AgentSettledEvent {
	return { type: "agent_settled", aborted };
}

function providerStreamEvent(data: unknown, provider = "openai", api = "openai-responses"): ProviderStreamEvent {
	return { type: "provider_stream_event", provider, api, model: "test", data } as ProviderStreamEvent;
}

function systemPromptOptions(sections: Record<string, string>): BeforeAgentStartEvent["systemPromptOptions"] {
	return {
		cwd: process.cwd(),
		selectedTools: [],
		hiddenTools: [],
		toolSnippets: {},
		toolGuidelines: {},
		promptGuidelines: [],
		appendSystemPrompt: "",
		sections,
		contextFiles: [],
		skills: [],
	};
}

/** A run that a submitted prompt starts; Pi ≥1.2.0 marks it `messageType: "user"`. */
function beforeAgentStartEvent(sections: Record<string, string>): BeforeAgentStartEvent {
	return {
		type: "before_agent_start",
		messageType: "user",
		prompt: "prompt",
		systemPrompt: "system prompt",
		systemPromptOptions: systemPromptOptions(sections),
	};
}

/** A run that `pi.sendMessage(..., { triggerTurn: true })` starts while idle; Pi ≥1.2.0 fires before_agent_start for it too. */
function beforeAgentStartCustomEvent(sections: Record<string, string>, customType: string, content: string): BeforeAgentStartEvent {
	return {
		type: "before_agent_start",
		messageType: "custom",
		message: { role: "custom", customType, content, display: false, timestamp: 1 },
		systemPrompt: "system prompt",
		systemPromptOptions: systemPromptOptions(sections),
	};
}

async function startTurn(extension: MockExtension, ctx: ExtensionContext, text = "prompt"): Promise<void> {
	await extension.emit("input", { type: "input", text, source: "interactive" }, ctx);
	await extension.emit("agent_start", { type: "agent_start" }, ctx);
}

function renderedDoneEntry(extension: MockExtension, ctx: ExtensionContext, data: unknown, width = 100): string {
	const component = extension.entryRenderers["pi-topping-done"]!(
		{ type: "custom", customType: "pi-topping-done", data }, { expanded: false }, ctx.ui.theme,
	) as { render(width: number): string[] };
	return component.render(width).join("\n");
}

type CustomFactory<T> = (
	tui: unknown,
	theme: unknown,
	keybindings: unknown,
	done: (result: T) => void,
) => unknown;

/** Mock fg that matches createContext's getFgAnsi so fadeThemeColorString can probe the colorizer. */
function truecolorThemeFg(color: string, text: string): string {
	const ansi = color === "dim" ? "\x1b[38;2;96;96;96m" : "\x1b[38;2;224;224;224m";
	return `${ansi}${text}\x1b[0m`;
}

function createContext(
	messages: (string | undefined)[],
	indicators: unknown[],
	fg: (color: string, text: string) => string = (_color, text) => text,
	options?: {
		mode?: string;
		notifications?: { message: string; type?: string }[];
		statuses?: { key: string; text: string | undefined }[];
		selectedModel?: string;
		/** Full selected model, for selections whose `api` matters; takes precedence over selectedModel. */
		model?: { provider: string; id: string; api: string; name?: string };
		thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
		onCustomComponent?: (component: { render(width: number): string[]; handleInput?(data: string): void; dispose?(): void }) => void;
	},
): ExtensionContext {
	const notifications = options?.notifications ?? [];
	const statuses = options?.statuses ?? [];
	const theme = {
		fg,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		getBgAnsi: () => "",
		getFgAnsi: (color: string) => color === "dim" ? "\x1b[38;2;96;96;96m" : "\x1b[38;2;224;224;224m",
		getThinkingBorderColor: (level: "off" | "minimal" | "low" | "medium" | "high" | "xhigh") => (text: string) => fg(`thinking-${level}`, text),
	};
	const fakeTui = { requestRender: () => {} };
	return {
		hasUI: true,
		mode: options?.mode ?? "tui",
		model: options?.model ?? (options?.selectedModel ? { provider: "test", id: options.selectedModel } : undefined),
		thinkingLevel: options?.thinkingLevel,
		ui: {
			theme,
			setWorkingMessage(message?: string) {
				messages.push(message);
			},
			setWorkingIndicator(options?: unknown) {
				indicators.push(options);
			},
			setStatus(key: string, text?: string) {
				statuses.push({ key, text });
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

function assistantMessage(output = 0, responseModel?: string): Extract<MessageEndEvent["message"], { role: "assistant" }> {
	return {
		role: "assistant",
		content: [],
		api: "test",
		provider: "test",
		model: "test",
		responseModel,
		usage: { input: 0, output, cacheRead: 0, cacheWrite: 0, totalTokens: output },
		stopReason: "stop",
		timestamp: 0,
	};
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}

const VIRTUAL_MODEL = { provider: "routesense", id: "auto", api: "pi-virtual" };

/** A CHANNELS.routedModel announcement as pi-topping-routesense emits it. */
function routedModel(modelId: string, reason = "user", provider = "openai-codex"): Record<string, unknown> {
	return {
		version: 1,
		provider,
		modelId,
		model: `${provider}/${modelId}`,
		name: modelId,
		thinkingLevel: "high",
		reason,
		cause: "jev_classifier",
		tier: "COMPLEX",
		ts: 1_790_000_000_000,
	};
}

function moveMenuCursor(component: { handleInput?(data: string): void }, fromId: string, toId: string): void {
	const ids = buildMenuSections(DEFAULT_SETTINGS, loadBundledWordPacks()).flatMap((section) => section.items.map((item) => item.id));
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

type RecordedTimer = { id: number; tick: () => void; ms: number | undefined };

/** Mock timers, recording each one's callback and delay and which of them have been cleared. */
function recordTimers(t: test.TestContext): { timers: RecordedTimer[]; cleared: Set<number> } {
	const timers: RecordedTimer[] = [];
	const cleared = new Set<number>();
	const schedule = (tick: () => void, ms?: number): number => {
		timers.push({ id: timers.length + 1, tick, ms });
		return timers.length;
	};
	const clear = (id: number): void => {
		cleared.add(id);
	};
	t.mock.method(globalThis, "setInterval", schedule as unknown as typeof setInterval);
	t.mock.method(globalThis, "setTimeout", schedule as unknown as typeof setTimeout);
	t.mock.method(globalThis, "clearInterval", clear as unknown as typeof clearInterval);
	t.mock.method(globalThis, "clearTimeout", clear as unknown as typeof clearTimeout);
	return { timers, cleared };
}

/** The most recently started response-model slide timer, if any. */
function slideTimer(timers: RecordedTimer[]): RecordedTimer | undefined {
	return timers.filter((timer) => timer.ms === RESPONSE_MODEL_SLIDE_FRAME_MS).at(-1);
}

function holdTimer(timers: RecordedTimer[]): RecordedTimer | undefined {
	return timers.filter((timer) => timer.ms === RESPONSE_MODEL_HOLD_MS).at(-1);
}

function fadeTimer(timers: RecordedTimer[], hold: RecordedTimer): RecordedTimer | undefined {
	return timers.filter((timer) => timer.ms === RESPONSE_MODEL_FADE_MS / TOKEN_RATE_FADE_SHADE_COUNT && timer.id > hold.id).at(-1);
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
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		now = 10_000;
		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		assert.match(messages.at(-1)!, /--- tps · 0s · ↓ 0 tokens/);
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

		assert.deepEqual(indicators.at(-1), {
			frames: SPINNER_FRAMES.map((frame) => `<thinking-off>${frame}</thinking-off>`),
		});
		const message = messages[0]!;
		const meter = "<dim>⢀</dim>".repeat(8);
		assert.ok(message.indexOf(meter) > 0);
		assert.ok(message.indexOf("<muted>0s</muted>") > message.indexOf(meter));
	});
});

test("thinking-level meter color follows the active thinking level", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, decorations: { ...DEFAULT_SETTINGS.decorations, meterColor: "thinking-level" } });
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], (color, text) => `<${color}>${text}</${color}>`, { thinkingLevel: "high" });
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

		// This assertion checks thinking-level coloring, not a particular meter scale.
		assert.match(messages.at(-1)!, /<thinking-high>[⣀⣠⣤⣴⣶⣾⣿]<\/thinking-high>/);
	});
});

test("meter saturates at the configured upper bound", async (t) => {
	await withTempAgentDir(async () => {
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		const timerCallbacks: Array<() => void> = [];
		mockTimers(t, (callback) => timerCallbacks.push(callback));

		const renderAtBound = async (meterUpperBoundTps: number): Promise<string> => {
			saveSettings({
				...DEFAULT_SETTINGS,
				decorations: { ...DEFAULT_SETTINGS.decorations, meterUpperBoundTps },
			});
			const extension = new MockExtension();
			const messages: (string | undefined)[] = [];
			const ctx = createContext(messages, []);
			workingDecorator(extension.asAPI());
			await extension.emit("agent_start", { type: "agent_start" }, ctx);
			const tick = timerCallbacks.at(-1)!;
			const partial = assistantMessage();
			await extension.emit("message_start", { type: "message_start", message: partial }, ctx);
			await extension.emit("message_update", {
				type: "message_update",
				message: partial,
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "one two three four five", partial },
			}, ctx);
			now += 100;
			tick();
			return stripAnsi(messages.at(-1)!);
		};

		assert.match(await renderAtBound(10), /⣿/);
		assert.match(await renderAtBound(1_000), /⣀/);
		assert.match(await renderAtBound(80), /⣠/);
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
		// One Math.random() call per pickWorkingTextSelection() invocation: the first (on
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
		assert.match(stripAnsi(messages.at(-1)!), /^Zigzagging/);

		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.equal(messages.at(-1), undefined);
		assert.deepEqual(indicators.at(-1), { frames: SPINNER_FRAMES });
	});
});

test("blocking UI prompts replace the busy loader with a stable waiting line and pulse", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const indicators: unknown[] = [];
		const ctx = createContext(messages, indicators, (color, text) => `<${color}>${text}</${color}>`);
		let tick: (() => void) | undefined;
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, (callback) => {
			tick = callback;
		});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("ui_prompt_start", { type: "ui_prompt_start", reason: "ui_prompt", kind: "confirm", title: "Allow host?" }, ctx);

		assert.equal(messages.at(-1), "<dim>Waiting: Allow host?</dim>");
		assert.deepEqual(indicators.at(-1), {
			frames: ["<dim>·</dim>", "<dim>•</dim>", "<dim>●</dim>", "<dim>•</dim>"],
			intervalMs: 120,
		});
		const messageCount = messages.length;
		tick!();
		tick!();
		assert.equal(messages.length, messageCount);

		await extension.emit("ui_prompt_end", { type: "ui_prompt_end", reason: "ui_prompt", kind: "confirm", title: "Allow host?" }, ctx);
		assert.notEqual(messages.at(-1), "<dim>Waiting: Allow host?</dim>");
		assert.deepEqual(indicators.at(-1), {
			frames: SPINNER_FRAMES.map((frame) => `<thinking-off>${frame}</thinking-off>`),
		});
	});
});

test("untitled UI prompts use kind-specific waiting labels", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		for (const [kind, label] of [
			["confirm", "Waiting for confirmation"],
			["select", "Waiting for selection"],
			["input", "Waiting for input"],
		] as const) {
			await extension.emit("ui_prompt_start", { type: "ui_prompt_start", reason: "ui_prompt", kind }, ctx);
			assert.equal(messages.at(-1), label);
			await extension.emit("ui_prompt_end", { type: "ui_prompt_end", reason: "ui_prompt", kind }, ctx);
		}
	});
});

test("idle UI prompt lifecycle does not change the loader", async () => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const indicators: unknown[] = [];
		const ctx = createContext(messages, indicators);
		workingDecorator(extension.asAPI());

		await extension.emit("ui_prompt_start", { type: "ui_prompt_start", reason: "ui_prompt", kind: "custom" }, ctx);
		await extension.emit("ui_prompt_end", { type: "ui_prompt_end", reason: "ui_prompt", kind: "custom" }, ctx);

		assert.deepEqual(messages, []);
		assert.deepEqual(indicators, []);
	});
});

test("settling while waiting restores the loader and retains wall-clock elapsed time", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const indicators: unknown[] = [];
		const ctx = createContext(messages, indicators);
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("ui_prompt_start", { type: "ui_prompt_start", reason: "ui_prompt", kind: "editor" }, ctx);
		now = 6_000;
		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.equal(messages.at(-1), undefined);
		assert.deepEqual(indicators.at(-1), { frames: SPINNER_FRAMES });
		assert.equal((extension.appendedEntries.at(-1)!.data as { elapsedMs: number }).elapsedMs, 5_000);

		const messageCount = messages.length;
		const indicatorCount = indicators.length;
		await extension.emit("ui_prompt_end", { type: "ui_prompt_end", reason: "ui_prompt", kind: "editor" }, ctx);
		assert.equal(messages.length, messageCount);
		assert.equal(indicators.length, indicatorCount);
	});
});

test("session shutdown clears a pending UI prompt", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("ui_prompt_start", { type: "ui_prompt_start", reason: "ui_prompt", kind: "input" }, ctx);
		await extension.emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
		messages.length = 0;
		await extension.emit("ui_prompt_end", { type: "ui_prompt_end", reason: "ui_prompt", kind: "input" }, ctx);
		assert.deepEqual(messages, []);
	});
});

test("SimCity working text refreshes on prompt and tool execution", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			features: { ...DEFAULT_SETTINGS.features },
			wordPacks: { simcity: true },
		});
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		const randomValues = [0, 0.999999];
		t.mock.method(Date, "now", () => 1_000);
		t.mock.method(Math, "random", () => randomValues.shift() ?? 0.999999);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("input", { type: "input", text: "prompt", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		assert.match(stripAnsi(messages.at(-1)!), /^Accomplishing/);

		await extension.emit("tool_execution_start", {
			type: "tool_execution_start",
			toolCallId: "tool-1",
			toolName: "read",
			args: {},
		}, ctx);
		assert.match(stripAnsi(messages.at(-1)!), /^Zeroing crime network/);
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
		assert.match(messages.at(-1)!, /<dim>--- tps<\/dim>/, "an inactive rate should use the dim placeholder");
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

		assert.match(messages.at(-1)!, /<warning>  8 tps<\/warning>/);
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

		assert.match(messages.at(-1)!, /<success>  8 tps<\/success>/);
	});
});

test("token rate follows the active thinking level when configured", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, decorations: { ...DEFAULT_SETTINGS.decorations, tokenRateColor: "thinking-level" } });
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], (color, text) => `<${color}>${text}</${color}>`, { thinkingLevel: "high" });
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

		assert.match(messages.at(-1)!, /<thinking-high>  8 tps<\/thinking-high>/);
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

		assert.match(messages.at(-1)!, /\x1b\[2m<warning>  8 tps<\/warning>\x1b\[22m/);
	});
});

test("token rate holds, fades, and resets to full brightness on updates", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], truecolorThemeFg);
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
		assert.match(messages.at(-1)!, /\x1b\[38;2;224;224;224m  8 tps\x1b\[0m/);

		const second = assistantMessage();
		await extension.emit("message_start", { type: "message_start", message: second }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: second,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "one two three four five", partial: second },
		}, ctx);
		now = 1_450;
		tick!();
		assert.match(messages.at(-1)!, /\x1b\[38;2;224;224;224m 20 tps\x1b\[0m/);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(5) }, ctx);

		now = 2_949;
		tick!();
		assert.match(messages.at(-1)!, /\x1b\[38;2;224;224;224m 20 tps\x1b\[0m/);
		now = 2_950;
		tick!();
		assert.match(messages.at(-1)!, /\x1b\[38;2;212;212;212m 20 tps\x1b\[0m/);
		now = 3_000;
		tick!();
		assert.match(messages.at(-1)!, /\x1b\[38;2;180;180;180m 20 tps\x1b\[0m/);

		const third = assistantMessage();
		await extension.emit("message_start", { type: "message_start", message: third }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: third,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "one two three four five", partial: third },
		}, ctx);
		now = 3_049;
		tick!();
		assert.match(messages.at(-1)!, /\x1b\[38;2;224;224;224m 20 tps\x1b\[0m/);

		now = 4_549;
		tick!();
		assert.match(messages.at(-1)!, /\x1b\[38;2;212;212;212m 20 tps\x1b\[0m/);
		now = 4_798;
		tick!();
		assert.match(messages.at(-1)!, /\x1b\[38;2;96;96;96m 20 tps\x1b\[0m/);
		now = 4_799;
		tick!();
		assert.match(messages.at(-1)!, /\x1b\[38;2;96;96;96m--- tps\x1b\[0m/);
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

		assert.ok(!messages.at(-1)!.includes("tps"));
	});
});

test("response model footer is disabled by default", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const statuses: { key: string; text: string | undefined }[] = [];
		const ctx = createContext([], [], undefined, { statuses });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "test-model") }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		assert.ok(statuses.every(({ text }) => text === undefined));
	});
});

test("response model footer works independently of the loader toggle", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			features: { ...DEFAULT_SETTINGS.features, responseModel: false, responseModelFooter: true },
		});
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const statuses: { key: string; text: string | undefined }[] = [];
		const ctx = createContext(messages, [], undefined, { statuses });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "test-model") }, ctx);
		assert.ok(!messages.at(-1)!.includes("test-model"));

		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.match(statuses.at(-1)!.text!, /test-model/);
	});
});

test("response model is sanitized, configurable, and holds then fades after settlement", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			decorations: { ...DEFAULT_SETTINGS.decorations, responseModelColor: "success", responseModelDimmed: true },
			features: { ...DEFAULT_SETTINGS.features, tokenRate: false, responseModelFooter: true },
		});
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const statuses: { key: string; text: string | undefined }[] = [];
		const ctx = createContext(messages, [], truecolorThemeFg, { statuses });
		t.mock.method(Date, "now", () => 1_000);
		const { timers, cleared } = recordTimers(t);

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "\u0000 test-model \u001b") }, ctx);
		assert.match(messages.at(-1)!, /\x1b\[2m\x1b\[38;2;224;224;224mtest-model\x1b\[0m\x1b\[22m$/);

		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.match(statuses.at(-1)!.text!, /\x1b\[2m\x1b\[38;2;224;224;224mtest-model\x1b\[0m\x1b\[22m$/);
		assert.equal(timers.filter((timer) => timer.ms === RESPONSE_MODEL_HOLD_MS).length, 1);
		const hold = holdTimer(timers);
		assert.ok(hold);
		hold.tick();
		assert.match(statuses.at(-1)!.text!, /\x1b\[2m\x1b\[38;2;/);
		const fade = fadeTimer(timers, hold);
		assert.ok(fade, "the fade timer starts after the hold");
		for (let i = 0; i < TOKEN_RATE_FADE_SHADE_COUNT; i++) fade.tick();
		assert.equal(statuses.at(-1)!.text, undefined);
		assert.ok(cleared.has(fade.id), "the fade timer stops after clearing the status");
	});
});

test("Switchyard response model overrides the configured loader color with NVIDIA green", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			decorations: { ...DEFAULT_SETTINGS.decorations, responseModelColor: "error" },
			features: { ...DEFAULT_SETTINGS.features, responseModelFooter: true },
		});
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const statuses: { key: string; text: string | undefined }[] = [];
		const ctx = createContext(messages, [], (color, text) => `<${color}>${text}</${color}>`, { statuses });
		ctx.model = { provider: "switchyard", id: "selected-model" } as NonNullable<ExtensionContext["model"]>;
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "test-model") }, ctx);

		assert.match(messages.at(-1)!, /\x1b\[38;2;132;197;26mtest-model\x1b\[39m/);
		assert.ok(!messages.at(-1)!.includes("<error>test-model</error>"));

		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.match(statuses.at(-1)!.text!, /\x1b\[38;2;132;197;26mtest-model\x1b\[39m/);
	});
});

test("thinking-level response model color follows the active thinking level", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			decorations: { ...DEFAULT_SETTINGS.decorations, responseModelColor: "thinking-level" },
			features: { ...DEFAULT_SETTINGS.features, responseModelFooter: true },
		});
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const statuses: { key: string; text: string | undefined }[] = [];
		const ctx = createContext(messages, [], (color, text) => `<${color}>${text}</${color}>`, { statuses, thinkingLevel: "high" });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "test-model") }, ctx);

		assert.match(messages.at(-1)!, /<thinking-high>test-model<\/thinking-high>/);

		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.match(statuses.at(-1)!.text!, /<thinking-high>test-model<\/thinking-high>/);
	});
});

test("response model preview follows the active thinking level", () => {
	const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`, { thinkingLevel: "high" });
	const preview = new PreviewRenderer(ctx).render({ responseModelColor: "thinking-level" });

	assert.ok(preview.lines.some((line) => line.includes("<thinking-high>test-model</thinking-high>")));
});

test("Switchyard response model preview overrides the selected color with NVIDIA green", () => {
	const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`);
	ctx.model = { provider: "switchyard", id: "selected-model" } as NonNullable<ExtensionContext["model"]>;
	const preview = new PreviewRenderer(ctx).render({ responseModelColor: "error" });

	assert.ok(preview.lines.some((line) => line.includes("\x1b[38;2;132;197;26mtest-model\x1b[39m")));
	assert.ok(preview.lines.every((line) => !line.includes("<error>test-model</error>")));
});

test("completion marker model preview follows its toggle and thinking-level color", () => {
	const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`, { thinkingLevel: "high" });
	const renderer = new PreviewRenderer(ctx);
	const at = (activeItemId: string) => ({ elapsedMs: 0, activeItemId, width: 300 });
	const shown = renderer.render({ doneMarker: true, doneMarkerModel: true, doneMarkerModelColor: "thinking-level" }, at("doneMarkerModel"));
	assert.ok(shown.lines.some((line) => line.includes("<thinking-high>test-model</thinking-high>")));

	const tierShown = renderer.render({ doneMarker: true, doneMarkerServiceTier: true }, at("doneMarkerServiceTier"));
	assert.ok(tierShown.lines.some((line) => line.includes("flex tier ×3")));
	const tierHidden = renderer.render({ doneMarker: true, doneMarkerServiceTier: false }, at("doneMarkerServiceTier"));
	assert.ok(tierHidden.lines.every((line) => !line.includes("flex tier")));

	const hidden = renderer.render({ doneMarker: true, doneMarkerModel: false }, at("doneMarkerModel"));
	assert.ok(hidden.lines.every((line) => !line.includes("test-model")));
});

test("preview without word packs selects from the shared base-word pool", (t) => {
	t.mock.method(Math, "random", () => 0);
	const preview = new PreviewRenderer(createContext([], [])).render({ shimmer: false });

	assert.ok(preview.lines.some((line) => line.includes(WORDS[0]!.present_tense)));
});

test("resembling response models are suppressed during streaming and settlement", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const statuses: { key: string; text: string | undefined }[] = [];
		const ctx = createContext(messages, [], undefined, { statuses, selectedModel: "qwen3-27b" });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		const partial = assistantMessage(0, "/models/Qwen3.8-27B-UD-IQ4_XS.gguf");
		await extension.emit("message_update", {
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "text", partial },
		}, ctx);
		assert.ok(!messages.at(-1)!.includes("Qwen3"));

		await extension.emit("message_end", { type: "message_end", message: partial }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.ok(statuses.every(({ text }) => text === undefined), "suppressed models must not start a response-model fade");
		assert.equal((extension.appendedEntries[0]!.data as { model?: string }).model, undefined);
	});
});

test("response models respelling the selected display name are suppressed", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, {
			model: { provider: "local", id: "qwen38-flash-next-iq2xs_local_256k", name: "Qwen3.8 Flash Next IQ2_XS (Local)", api: "openai-completions" },
		});
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		const report = async (responseModel: string): Promise<void> => {
			const partial = assistantMessage(0, responseModel);
			await extension.emit("message_update", {
				type: "message_update",
				message: partial,
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "text", partial },
			}, ctx);
		};

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await report("qwen3.8-flash-next-iq3_xs");
		assert.match(stripAnsi(messages.at(-1)!), / · qwen3\.8-flash-next-iq3_xs$/, "a different quantization shows");

		await report("qwen3.8-flash-next-iq2_xs");
		assert.ok(!stripAnsi(messages.at(-1)!).includes("qwen3.8"), "the display name respelled is hidden");
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "qwen3.8-flash-next-iq2_xs") }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.equal((extension.appendedEntries[0]!.data as { model?: string }).model, undefined);
	});
});

test("auto selections retain resolved response models and clear stale streamed values", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, responseModelFooter: true } });
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const statuses: { key: string; text: string | undefined }[] = [];
		const ctx = createContext(messages, [], undefined, { statuses, selectedModel: "auto" });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		const resolved = assistantMessage(0, "resolved-model");
		await extension.emit("message_update", {
			type: "message_update",
			message: resolved,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "text", partial: resolved },
		}, ctx);
		assert.match(messages.at(-1)!, /resolved-model/);

		const selected = assistantMessage(0, "AUTO");
		await extension.emit("message_update", {
			type: "message_update",
			message: selected,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "text", partial: selected },
		}, ctx);
		assert.ok(!messages.at(-1)!.includes("resolved-model"));

		await extension.emit("message_end", { type: "message_end", message: resolved }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.match(statuses.at(-1)!.text!, /resolved-model/);
	});
});

test("response model fade is cancelled by a new run and shutdown", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, responseModelFooter: true } });
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const statuses: { key: string; text: string | undefined }[] = [];
		const ctx = createContext(messages, [], undefined, { statuses });
		t.mock.method(Date, "now", () => 1_000);
		const { timers, cleared } = recordTimers(t);

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "test-model") }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		const firstHold = holdTimer(timers);
		assert.ok(firstHold);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		assert.ok(cleared.has(firstHold.id), "a new run clears the pending hold timer");
		const afterNewRun = statuses.length;
		const fadeBefore = fadeTimer(timers, firstHold);
		firstHold.tick();
		assert.equal(statuses.length, afterNewRun);
		assert.equal(fadeTimer(timers, firstHold), fadeBefore, "a cancelled hold schedules no fade timer");

		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "test-model") }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.equal(timers.filter((timer) => timer.ms === RESPONSE_MODEL_HOLD_MS).length, 2);
		const secondHold = holdTimer(timers);
		assert.ok(secondHold && secondHold !== firstHold);
		secondHold.tick();
		const fade = fadeTimer(timers, secondHold);
		assert.ok(fade, "the next hold starts a fade timer");
		await extension.emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
		assert.equal(statuses.at(-1)!.text, undefined);
		assert.ok(cleared.has(fade.id), "shutdown clears the active fade timer");
		const afterShutdown = statuses.length;
		fade.tick();
		assert.equal(statuses.length, afterShutdown);
	});
});

test("a newly reported response model slides out of the loader tail first", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		const { timers, cleared } = recordTimers(t);

		workingDecorator(extension.asAPI());
		// Statusline can announce before this extension's session_start handler runs.
		extension.events.emit(CHANNELS.workingStatusEmbedded, { embedded: true });
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "test-model") }, ctx);
		const slide = slideTimer(timers);
		assert.ok(slide, "an appearing response model repaints on its own slide timer");
		assert.match(stripAnsi(messages.at(-1)!), /↓ 0 tokens$/, "neither the model nor its separator shows before its first cell");

		now += WORKING_STATUS_SLIDE_MS / 2;
		slide.tick();
		assert.match(stripAnsi(messages.at(-1)!), /↓ 0 tokens · model$/, "halfway through, the model's tail half has emerged");
		assert.ok(!cleared.has(slide.id));

		now += WORKING_STATUS_SLIDE_MS / 2;
		slide.tick();
		assert.match(stripAnsi(messages.at(-1)!), /↓ 0 tokens · test-model$/);
		assert.ok(cleared.has(slide.id), "the slide timer stops once the model is fully out");
	});
});

test("a replacement response model swaps in place, but one shown again after being hidden slides out", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, { selectedModel: "auto" });
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		const { timers } = recordTimers(t);
		const report = async (responseModel: string): Promise<void> => {
			const partial = assistantMessage(0, responseModel);
			await extension.emit("message_update", {
				type: "message_update",
				message: partial,
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "", partial },
			}, ctx);
		};

		workingDecorator(extension.asAPI());
		extension.events.emit(CHANNELS.workingStatusEmbedded, { embedded: true });
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await report("first-model");
		const firstSlide = slideTimer(timers);
		now += WORKING_STATUS_SLIDE_MS;
		firstSlide!.tick();

		await report("second-model");
		assert.match(stripAnsi(messages.at(-1)!), / · second-model$/, "a replacement shows whole at once");
		assert.equal(slideTimer(timers), firstSlide, "without starting another slide");

		await report("AUTO");
		assert.ok(!stripAnsi(messages.at(-1)!).includes("second-model"), "a model resembling the selection is hidden");
		await report("third-model");
		assert.notEqual(slideTimer(timers), firstSlide, "a model shown again after being hidden slides out again");
		assert.ok(!stripAnsi(messages.at(-1)!).includes("third-model"), "starting from nothing");
	});
});

test("settling or shutting down mid-slide stops the response model's slide timer", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		const { timers, cleared } = recordTimers(t);

		workingDecorator(extension.asAPI());
		extension.events.emit(CHANNELS.workingStatusEmbedded, { embedded: true });
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "test-model") }, ctx);
		const settled = slideTimer(timers);
		assert.ok(settled);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.ok(cleared.has(settled.id), "settling stops the slide");

		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "test-model") }, ctx);
		const shutDown = slideTimer(timers);
		assert.ok(shutDown && shutDown !== settled, "the next run's model slides out again");
		await extension.emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, ctx);
		assert.ok(cleared.has(shutDown.id), "shutting down stops the slide");
	});
});

test("a response model hidden from the loader starts no slide", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, responseModel: false } });
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		const { timers } = recordTimers(t);

		workingDecorator(extension.asAPI());
		extension.events.emit(CHANNELS.workingStatusEmbedded, { embedded: true });
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "test-model") }, ctx);
		assert.equal(slideTimer(timers), undefined);
	});
});

test("a response model shows whole at once unless pi-topping-statusline embeds the loader", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		t.mock.method(Date, "now", () => 1_000);
		const { timers } = recordTimers(t);
		const run = async (): Promise<void> => {
			await extension.emit("agent_start", { type: "agent_start" }, ctx);
			await extension.emit("message_end", { type: "message_end", message: assistantMessage(0, "test-model") }, ctx);
		};

		workingDecorator(extension.asAPI());
		await run();
		assert.match(stripAnsi(messages.at(-1)!), /↓ 0 tokens · test-model$/, "without statusline announcing, the model shows at once");
		assert.equal(slideTimer(timers), undefined);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		extension.events.emit(CHANNELS.workingStatusEmbedded, { embedded: true });
		extension.events.emit(CHANNELS.workingStatusEmbedded, { embedded: false });
		await run();
		assert.match(stripAnsi(messages.at(-1)!), /↓ 0 tokens · test-model$/, "nor once statusline stops embedding the loader");
		assert.equal(slideTimer(timers), undefined);
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

		assert.match(messages.at(-1)!, /<warning>  8 tps<\/warning>/);
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

test("substituteDefaultMessage=false shows a Working placeholder but other enabled toggles still apply", async (t) => {
	await withTempAgentDir(async () => {
		// The SimCity source is enabled, but substituteDefaultMessage remains the
		// master switch. The other enabled toggles still show alongside the plain
		// "Working" placeholder.
		saveSettings({
			...DEFAULT_SETTINGS,
			features: { ...DEFAULT_SETTINGS.features, substituteDefaultMessage: false },
			wordPacks: { simcity: true },
		});

		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		t.mock.method(Date, "now", () => 1_000);
		t.mock.method(Math, "random", () => 0);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		assert.equal(messages.length, 1);
		const message = messages[0]!;
		assert.match(stripAnsi(message), /^Working/);
		assert.ok(!message.includes("Accomplishing"));
		assert.match(message, /--- tps \u00b7 0s \u00b7 \u2193 0 tokens/);
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
			wordPacks: { ...DEFAULT_SETTINGS.wordPacks },
			outputStyle: DEFAULT_SETTINGS.outputStyle,
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
			/^0s Working [\u280b\u2819\u2839\u2838\u283c\u2834\u2826\u2827\u2807\u280f] \u2193 0 tokens \u00b7 --- tps$/,
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
		assert.match(first, /^Working [\u280b\u2819\u2839\u2838\u283c\u2834\u2826\u2827\u2807\u280f]$/);

		now += 80;
		tick!();
		assert.notEqual(stripAnsi(messages.at(-1)!), first);
	});
});

test("in-message default spinner uses the active thinking-level color", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			decorations: { ...DEFAULT_SETTINGS.decorations, shimmer: false, tokenActivityMonitor: false },
			features: { ...DEFAULT_SETTINGS.features, substituteDefaultMessage: false, elapsedTime: false, outputTokens: false, tokenRate: false },
			loaderOrder: ["text", "spinner", "meter", "elapsed", "tokens", "tokenRate", "responseModel"],
		});
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], (color, text) => `<${color}>${text}</${color}>`, { thinkingLevel: "high" });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		const extension = new MockExtension();
		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		assert.match(messages.at(-1)!, /<thinking-high>⠹<\/thinking-high>/);
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
		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.deepEqual(indicators.at(-1), { frames: [] });
	});
});

test("animatedSpinner=true (default) uses thinking-level spinner frames", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const indicators: unknown[] = [];
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, indicators, (color, text) => `<${color}>${text}</${color}>`, { thinkingLevel: "high" });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		assert.ok(!indicators.some((i) => JSON.stringify(i) === JSON.stringify({ frames: [] })));
		assert.deepEqual(indicators.at(-1), {
			frames: SPINNER_FRAMES.map((frame) => `<thinking-high>${frame}</thinking-high>`),
		});
	});
});

test("agent_start refreshes the leading spinner when thinking level changes between turns", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const indicators: unknown[] = [];
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, indicators, (color, text) => `<${color}>${text}</${color}>`, { thinkingLevel: "off" });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		assert.deepEqual(indicators.at(-1), {
			frames: SPINNER_FRAMES.map((frame) => `<thinking-off>${frame}</thinking-off>`),
		});

		(ctx as ExtensionContext & { thinkingLevel: "high" }).thinkingLevel = "high";
		await extension.emit("agent_start", { type: "agent_start" }, ctx);

		assert.deepEqual(indicators.at(-1), {
			frames: SPINNER_FRAMES.map((frame) => `<thinking-high>${frame}</thinking-high>`),
		});
	});
});

test("accent spinner sends explicit accent frames", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, decorations: { ...DEFAULT_SETTINGS.decorations, spinnerColor: "accent" } });
		const indicators: unknown[] = [];
		const ctx = createContext([], indicators, (color, text) => `<${color}>${text}</${color}>`);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		const extension = new MockExtension();
		workingDecorator(extension.asAPI());
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		assert.deepEqual(indicators.at(-1), { frames: ["<accent>⠋</accent>", "<accent>⠙</accent>", "<accent>⠹</accent>", "<accent>⠸</accent>", "<accent>⠼</accent>", "<accent>⠴</accent>", "<accent>⠦</accent>", "<accent>⠧</accent>", "<accent>⠇</accent>", "<accent>⠏</accent>"] });
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
		assert.match(message, /--- tps \u00b7 \u2193 0 tokens/);
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

test("Default output style leaves foreign prompt sections untouched", async () => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		workingDecorator(extension.asAPI());

		const sections = { foo: "x" };
		const result = await extension.emit("before_agent_start", beforeAgentStartEvent(sections), ctx);
		assert.equal(result, undefined);
		assert.deepEqual(sections, { foo: "x" });
	});
});

test("Explanatory style injects prompt guidance and a reminder without a footer status", async () => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, outputStyle: "explanatory" });
		const extension = new MockExtension();
		const statuses: { key: string; text: string | undefined }[] = [];
		const ctx = createContext([], [], undefined, { statuses });
		workingDecorator(extension.asAPI());
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		assert.equal(statuses.some(({ text }) => text?.includes("Explanatory")), false);

		const sections = { foo: "x" };
		const result = await extension.emit("before_agent_start", beforeAgentStartEvent(sections), ctx);
		assert.deepEqual(sections, { foo: "x", [OUTPUT_STYLE_SECTION]: EXPLANATORY_SECTION });
		assert.deepEqual(result, {
			message: { customType: OUTPUT_STYLE_MESSAGE_TYPE, content: EXPLANATORY_REMINDER, display: false },
		});
	});
});

test("a non-default output style sends one decorated prompt, and the hook adds the section and reminder to its run", async () => {
	await withTempAgentDir(async () => {
		for (const [outputStyle, section, reminder] of [
			["explanatory", EXPLANATORY_SECTION, EXPLANATORY_REMINDER],
			["simplified", SIMPLIFIED_TECHNICAL_ENGLISH_SECTION, SIMPLIFIED_TECHNICAL_ENGLISH_REMINDER],
		] as const) {
			saveSettings({ ...DEFAULT_SETTINGS, outputStyle });
			const extension = new MockExtension();
			const ctx = createContext([], []);
			workingDecorator(extension.asAPI());

			const result = await extension.emit("input", { type: "input", text: "plain prompt", source: "interactive" }, ctx);

			assert.deepEqual(result, { action: "handled" });
			assert.equal(extension.sentMessages.length, 1);
			const [box] = extension.sentMessages as {
				message: { customType: string; content: string; display: boolean };
				options: { triggerTurn: boolean };
			}[];
			assert.equal(box!.message.customType, PROMPT_BOX_TYPE);
			assert.equal(box!.message.content, "plain prompt");
			assert.equal(box!.message.display, true);
			assert.deepEqual(box!.options, { triggerTurn: true });

			// Pi ≥1.2.0 runs before_agent_start for the run that the prompt box starts.
			const sections = { foo: "x" };
			const hook = await extension.emit("before_agent_start", beforeAgentStartCustomEvent(sections, PROMPT_BOX_TYPE, "plain prompt"), ctx);
			assert.deepEqual(sections, { foo: "x", [OUTPUT_STYLE_SECTION]: section });
			assert.deepEqual(hook, { message: { customType: OUTPUT_STYLE_MESSAGE_TYPE, content: reminder, display: false } });
		}
	});
});

test("another extension's custom-started run gets the prompt section without a reminder", async () => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, outputStyle: "simplified" });
		const extension = new MockExtension();
		const ctx = createContext([], []);
		workingDecorator(extension.asAPI());

		const sections = { foo: "x" };
		const result = await extension.emit("before_agent_start", beforeAgentStartCustomEvent(sections, "other-extension", "job"), ctx);

		assert.equal(result, undefined);
		assert.deepEqual(sections, { foo: "x", [OUTPUT_STYLE_SECTION]: SIMPLIFIED_TECHNICAL_ENGLISH_SECTION });
	});
});

test("a custom-started run under the Default style clears an owned prompt section", async () => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		workingDecorator(extension.asAPI());

		// Default style, decorated prompt: the prompt box itself starts the run on Pi ≥1.2.0.
		const sections = { foo: "x", [OUTPUT_STYLE_SECTION]: EXPLANATORY_SECTION };
		const result = await extension.emit("before_agent_start", beforeAgentStartCustomEvent(sections, PROMPT_BOX_TYPE, "plain prompt"), ctx);

		assert.equal(result, undefined);
		assert.deepEqual(sections, { foo: "x" });
	});
});

test("session_start warns once on a host older than the minimum and stays quiet on a supported one", async () => {
	await withTempAgentDir(async () => {
		for (const [hostVersion, expectedWarnings] of [["1.1.0", 1], ["1.2.0", 0]] as const) {
			const extension = new MockExtension();
			const notifications: { message: string; type?: string }[] = [];
			const ctx = createContext([], [], undefined, { notifications });
			new SessionManager(extension.asAPI(), hostVersion).install();

			await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
			await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

			const warnings = notifications.filter(({ message }) => message.includes(`Pi ${MIN_HOST_VERSION} or later`));
			assert.equal(warnings.length, expectedWarnings, `host ${hostVersion}`);
			if (expectedWarnings) {
				assert.equal(warnings[0]!.type, "warning");
				assert.match(warnings[0]!.message, /this is Pi 1\.1\.0/);
			}
		}
	});
});

test("print mode applies Explanatory prompt guidance", async () => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, outputStyle: "explanatory" });
		const extension = new MockExtension();
		const ctx = createContext([], [], undefined, { mode: "print" });
		workingDecorator(extension.asAPI());
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);

		const sections: Record<string, string> = {};
		const result = await extension.emit("before_agent_start", beforeAgentStartEvent(sections), ctx);
		assert.equal(sections[OUTPUT_STYLE_SECTION], EXPLANATORY_SECTION);
		assert.deepEqual(result, {
			message: { customType: OUTPUT_STYLE_MESSAGE_TYPE, content: EXPLANATORY_REMINDER, display: false },
		});
	});
});

test("Output Style menu cycles with arrows, previews, and applies on Enter", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		let capturedComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
		const notifications: { message: string; type?: string }[] = [];
		const statuses: { key: string; text: string | undefined }[] = [];
		mockTimers(t, () => {});
		const ctx = createContext([], [], (_color, text) => text, {
			mode: "tui",
			notifications,
			statuses,
			onCustomComponent: (component) => { capturedComponent = component; },
		}) as unknown as ExtensionCommandContext;

		workingDecorator(extension.asAPI());
		const handlerPromise = extension.commands["topping-settings"]!.handler("", ctx);
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(capturedComponent);
		moveMenuCursor(capturedComponent!, "decorateUserPrompt", "outputStyle");

		const initial = capturedComponent!.render(72).map(stripAnsi).join("\n");
		assert.ok(initial.includes("‹ Default ›"));
		assert.ok(initial.includes(OUTPUT_STYLES.default.description));
		assert.ok(initial.includes("Applies from your next message"));

		capturedComponent!.handleInput!("\x1b[C");
		const explanatory = capturedComponent!.render(72).map(stripAnsi).join("\n");
		assert.ok(explanatory.includes("‹ Explanatory ›"));
		assert.ok(explanatory.includes(OUTPUT_STYLES.explanatory.description));
		capturedComponent!.handleInput!(" ");
		assert.ok(capturedComponent!.render(72).map(stripAnsi).join("\n").includes("‹ Explanatory ›"), "Space does not change a cycle-only row");

		capturedComponent!.handleInput!("\r");
		await handlerPromise;
		assert.equal(loadSettings().outputStyle, "explanatory");
		assert.equal(statuses.some(({ text }) => text?.includes("Explanatory")), false);
		assert.match(notifications.at(-1)!.message, /next message/);

		const sections: Record<string, string> = {};
		const result = await extension.emit("before_agent_start", beforeAgentStartEvent(sections), ctx);
		assert.equal(sections[OUTPUT_STYLE_SECTION], EXPLANATORY_SECTION);
		assert.deepEqual(result, {
			message: { customType: OUTPUT_STYLE_MESSAGE_TYPE, content: EXPLANATORY_REMINDER, display: false },
		});
	});
});

test("switching Output Style back to Default clears the owned prompt section", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, outputStyle: "explanatory" });
		const extension = new MockExtension();
		let capturedComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
		const notifications: { message: string; type?: string }[] = [];
		mockTimers(t, () => {});
		const ctx = createContext([], [], (_color, text) => text, {
			mode: "tui",
			notifications,
			onCustomComponent: (component) => { capturedComponent = component; },
		}) as unknown as ExtensionCommandContext;

		workingDecorator(extension.asAPI());
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		const handlerPromise = extension.commands["topping-settings"]!.handler("", ctx);
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(capturedComponent);
		moveMenuCursor(capturedComponent!, "decorateUserPrompt", "outputStyle");
		capturedComponent!.handleInput!("\x1b[D");
		assert.ok(capturedComponent!.render(72).map(stripAnsi).join("\n").includes("‹ Default ›"));
		capturedComponent!.handleInput!("\r");
		await handlerPromise;

		assert.equal(loadSettings().outputStyle, "default");
		assert.match(notifications.at(-1)!.message, /Default output style applies from your next message/);
		const sections = { foo: "x", [OUTPUT_STYLE_SECTION]: EXPLANATORY_SECTION };
		const result = await extension.emit("before_agent_start", beforeAgentStartEvent(sections), ctx);
		assert.equal(result, undefined);
		assert.deepEqual(sections, { foo: "x" });
	});
});

test("Escape after cycling Output Style does not save the selection", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		let capturedComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
		mockTimers(t, () => {});
		const ctx = createContext([], [], (_color, text) => text, {
			mode: "tui",
			onCustomComponent: (component) => { capturedComponent = component; },
		}) as unknown as ExtensionCommandContext;

		workingDecorator(extension.asAPI());
		const handlerPromise = extension.commands["topping-settings"]!.handler("", ctx);
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(capturedComponent);
		moveMenuCursor(capturedComponent!, "decorateUserPrompt", "outputStyle");
		capturedComponent!.handleInput!("\x1b[C");
		capturedComponent!.handleInput!("\x1b");
		await handlerPromise;
		assert.equal(loadSettings().outputStyle, "default");
	});
});

test("upper bound row is discoverable and validates typed input", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		let capturedComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		const ctx = createContext([], [], (_color, text) => text, {
			mode: "tui",
			onCustomComponent: (component) => { capturedComponent = component; },
		}) as unknown as ExtensionCommandContext;

		workingDecorator(extension.asAPI());
		const handlerPromise = extension.commands["topping-settings"]!.handler("", ctx);
		await new Promise((resolve) => setImmediate(resolve));
		assert.ok(capturedComponent);
		moveMenuCursor(capturedComponent!, "decorateUserPrompt", "meterUpperBoundTps");

		const initial = capturedComponent!.render(72).map(stripAnsi).join("\n");
		assert.match(initial, /Token activity monitor upper bound/);
		assert.match(initial, /‹ 80 tps ›/);
		assert.match(initial, /␣ type 10–1000/);

		capturedComponent!.handleInput!(" ");
		for (const digit of "250") capturedComponent!.handleInput!(digit);
		capturedComponent!.handleInput!("\r");
		assert.match(capturedComponent!.render(72).map(stripAnsi).join("\n"), /‹ 250 tps ›/);

		capturedComponent!.handleInput!(" ");
		capturedComponent!.handleInput!("5");
		capturedComponent!.handleInput!("\r");
		assert.match(capturedComponent!.render(72).map(stripAnsi).join("\n"), /Enter a whole number from 10 to 1000 tps/);
		capturedComponent!.handleInput!("\x1b");
		// Enter on the number row opens its editor, so apply from the row above.
		capturedComponent!.handleInput!("\x1b[A");
		capturedComponent!.handleInput!("\r");
		await handlerPromise;

		assert.equal(loadSettings().decorations.meterUpperBoundTps, 250);
	});
});

test("a changed upper bound applies to subsequent meter updates", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		let capturedComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		const { timers } = recordTimers(t);
		const ctx = createContext(messages, [], (_color, text) => text, {
			mode: "tui",
			onCustomComponent: (component) => { capturedComponent = component; },
		}) as unknown as ExtensionCommandContext;

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		const handlerPromise = extension.commands["topping-settings"]!.handler("", ctx);
		await new Promise((resolve) => setImmediate(resolve));
		moveMenuCursor(capturedComponent!, "decorateUserPrompt", "meterUpperBoundTps");
		capturedComponent!.handleInput!(" ");
		for (const digit of "10") capturedComponent!.handleInput!(digit);
		capturedComponent!.handleInput!("\r");
		capturedComponent!.handleInput!("\x1b[A"); // Enter on the number row would reopen its editor
		capturedComponent!.handleInput!("\r");
		await handlerPromise;

		const partial = assistantMessage();
		await extension.emit("message_start", { type: "message_start", message: partial }, ctx);
		await extension.emit("message_update", {
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "one two three four five", partial },
		}, ctx);
		now += 100;
		timers.at(-1)!.tick();
		assert.match(stripAnsi(messages.at(-1)!), /⣿/);
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
		assert.ok(animated.some((l) => l.includes("Accomplishing")));
		assert.ok(animated.some((l) => l.includes(" 28 tps")));
		const normalShimmer = animatedRaw.find((l) => stripAnsi(l).includes("Accomplishing"))!;
		assert.match(normalShimmer, /\x1b\[1m/);

		// Inverting the shimmer keeps the resting text bright, then sweeps a dimmed gradient without bolding it.
		moveMenuCursor(capturedComponent!, "animatedSpinner", "shimmerInverted");
		capturedComponent!.handleInput!(" ");
		const invertedRaw = capturedComponent!.render(76);
		const invertedShimmer = invertedRaw.find((l) => stripAnsi(l).includes("Accomplishing"))!;
		assert.doesNotMatch(invertedShimmer, /\x1b\[1m/);
		assert.match(invertedShimmer, /\x1b\[38;2;224;224;224m/);
		const invertedColors = [...invertedShimmer.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)].map((match) => Number(match[1]));
		assert.ok(invertedColors.some((red) => red < 224), "expected the shimmer to dim the text");

		// Toggling Token rate updates the preview immediately.
		moveMenuCursor(capturedComponent!, "shimmerInverted", "showTokenRate");
		capturedComponent!.handleInput!(" ");
		const withoutTokenRate = capturedComponent!.render(76).map(stripAnsi);
		assert.ok(!withoutTokenRate.some((l) => l.includes(" 28 tps")));

		// Close the menu (Escape = cancel) so the command handler resolves and
		// the preview animation timer is disposed via component.dispose().
		capturedComponent!.handleInput!("\x1b");
		await handlerPromise;
	});
});

test("/topping-settings shows SimCity pack metadata", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		let capturedComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
		let now = 1_000;
		let previewTick: (() => void) | undefined;
		t.mock.method(Date, "now", () => now);
		const randomValues = [0, 0.999999];
		t.mock.method(Math, "random", () => randomValues.shift() ?? 0.999999);
		mockTimers(t, (callback) => {
			previewTick = callback;
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

		moveMenuCursor(capturedComponent!, "decorateUserPrompt", "pack:simcity");
		capturedComponent!.handleInput!(" ");

		const initial = capturedComponent!.render(72).map(stripAnsi).join("\n");
		assert.ok(initial.includes("SimCity: enabled"));
		assert.ok(initial.includes("105 phrases · Shipped example"));

		now += 1_000;
		previewTick?.();
		const refreshed = capturedComponent!.render(72).map(stripAnsi).join("\n");
		assert.ok(refreshed.includes("SimCity: enabled"));

		capturedComponent!.handleInput!("\x1b");
		await handlerPromise;
	});
});

test("/topping-settings applies enabled packs to the live session", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		let capturedComponent: { render(width: number): string[]; handleInput?(data: string): void } | undefined;
		t.mock.method(Date, "now", () => 1_000);
		t.mock.method(Math, "random", () => 0.999999);
		mockTimers(t, () => {});

		const ctx = createContext(messages, [], (_color, text) => text, {
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
		moveMenuCursor(capturedComponent!, "shimmer", "pack:simcity");
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
		assert.equal(persisted.wordPacks.simcity, true);
		assert.equal(persisted.features.elapsedTime, true);

		const sessionCtx = createContext(messages, []);
		await extension.emit("agent_start", { type: "agent_start" }, sessionCtx);
		assert.match(stripAnsi(messages.at(-1)!), /^Zeroing crime network/);
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
		// advancing the cursor. Cycle-only rows advance on right arrow.
		const rows = buildMenuSections(DEFAULT_SETTINGS, loadBundledWordPacks()).flatMap((section) => section.items);
		for (const [index, row] of rows.entries()) {
			if (index > 0) capturedComponent!.handleInput!("\x1b[B");
			if (row.kind === "reorder") continue;
			if ((row.kind === "cycle" && !row.gate) || row.kind === "number") {
				capturedComponent!.handleInput!("\x1b[C");
			} else {
				capturedComponent!.handleInput!(" ");
			}
		}

		// Apply.
		capturedComponent!.handleInput!("\r");
		await handlerPromise;

		const persisted = loadSettings();
		assert.equal(persisted.decorations.decorateUserPrompt, !DEFAULT_SETTINGS.decorations.decorateUserPrompt);
		assert.equal(persisted.decorations.borderColorEnabled, false);
		assert.equal(persisted.decorations.borderColor, "thinking-level");
		assert.equal(persisted.decorations.borderStyleEnabled, false);
		assert.equal(persisted.decorations.borderStyle, "double");
		assert.equal(persisted.decorations.promptIcon, !DEFAULT_SETTINGS.decorations.promptIcon);
		assert.equal(persisted.decorations.promptTimestamp, !DEFAULT_SETTINGS.decorations.promptTimestamp);
		assert.equal(persisted.decorations.promptProvider, !DEFAULT_SETTINGS.decorations.promptProvider);
		assert.equal(persisted.decorations.promptModel, !DEFAULT_SETTINGS.decorations.promptModel);
		assert.equal(persisted.decorations.animatedSpinner, !DEFAULT_SETTINGS.decorations.animatedSpinner);
		assert.equal(persisted.decorations.spinnerColorEnabled, false);
		assert.equal(persisted.decorations.spinnerColor, "thinking-level");
		assert.equal(
			persisted.features.substituteDefaultMessage,
			!DEFAULT_SETTINGS.features.substituteDefaultMessage,
		);
		assert.equal(persisted.wordPacks.simcity, !DEFAULT_SETTINGS.wordPacks.simcity);
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
		assert.equal(persisted.decorations.meterUpperBoundTps, 100);
		assert.equal(persisted.features.elapsedTime, !DEFAULT_SETTINGS.features.elapsedTime);
		assert.equal(persisted.features.outputTokens, !DEFAULT_SETTINGS.features.outputTokens);
		assert.equal(persisted.features.tokenRate, !DEFAULT_SETTINGS.features.tokenRate);
		assert.equal(persisted.decorations.tokenRateColor, "text");
		assert.equal(persisted.decorations.tokenRateDimmed, !DEFAULT_SETTINGS.decorations.tokenRateDimmed);
		assert.equal(persisted.features.responseModel, !DEFAULT_SETTINGS.features.responseModel);
		assert.equal(persisted.decorations.responseModelColor, "border");
		assert.equal(persisted.decorations.responseModelDimmed, !DEFAULT_SETTINGS.decorations.responseModelDimmed);
		assert.equal(persisted.features.doneMarker, !DEFAULT_SETTINGS.features.doneMarker);
		assert.equal(persisted.decorations.doneMarkerStyle, "bookend");
		assert.equal(persisted.decorations.doneMarkerBorderStyle, "double");
		assert.equal(persisted.decorations.doneMarkerBorderColor, "accent");
		assert.equal(persisted.features.doneMarkerIcon, !DEFAULT_SETTINGS.features.doneMarkerIcon);
		assert.equal(persisted.features.randomizeDoneMarker, !DEFAULT_SETTINGS.features.randomizeDoneMarker);
		assert.equal(persisted.features.doneMarkerTokens, !DEFAULT_SETTINGS.features.doneMarkerTokens);
		assert.equal(persisted.features.doneMarkerInputs, !DEFAULT_SETTINGS.features.doneMarkerInputs);
		assert.equal(persisted.features.doneMarkerServiceTier, !DEFAULT_SETTINGS.features.doneMarkerServiceTier);
		assert.equal(persisted.features.doneMarkerModel, !DEFAULT_SETTINGS.features.doneMarkerModel);
		assert.equal(persisted.decorations.doneMarkerModelColor, "thinking-level");
		assert.equal(persisted.decorations.doneMarkerModelDimmed, !DEFAULT_SETTINGS.decorations.doneMarkerModelDimmed);
		assert.equal(persisted.decorations.useNerdFont, !DEFAULT_SETTINGS.decorations.useNerdFont);
		assert.equal(persisted.features.responseModelFooter, !DEFAULT_SETTINGS.features.responseModelFooter);
		assert.equal(persisted.outputStyle, "explanatory");
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

		const rows = buildMenuSections(DEFAULT_SETTINGS, loadBundledWordPacks()).flatMap((section) => section.items);
		const firstReorderRow = rows.findIndex((row) => row.kind === "reorder");
		for (let i = 0; i < firstReorderRow; i++) capturedComponent!.handleInput!("\x1b[B");

		function previewLine(): string {
			return capturedComponent!.render(72).map(stripAnsi).find((l) => l.includes("Accomplishing"))!;
		}

		const before = previewLine();
		assert.ok(before.indexOf("\u280b") < before.indexOf("Accomplishing"), `expected a leading spinner: ${JSON.stringify(before)}`);

		capturedComponent!.handleInput!(" "); // grab the spinner row
		capturedComponent!.handleInput!("\x1b[B"); // slide it past the working text
		const after = previewLine();
		assert.ok(after.indexOf("\u280b") > after.indexOf("Accomplishing"), `expected the spinner to follow the word: ${JSON.stringify(after)}`);

		// Enter on a reorder row releases it rather than applying, so release and apply from the row above the group.
		capturedComponent!.handleInput!(" ");
		capturedComponent!.handleInput!("\x1b[A");
		capturedComponent!.handleInput!("\x1b[A");
		capturedComponent!.handleInput!("\r");
		await handlerPromise;

		assert.deepEqual(loadSettings().loaderOrder, ["text", "spinner", "meter", "tokenRate", "elapsed", "tokens", "responseModel"]);
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
		assert.ok(lines.some((l) => l.includes("Working")));
		assert.ok(!lines.some((l) => l.includes("Accomplishing")));
		// ...but elapsed time and output tokens (still on) keep showing.
		assert.ok(lines.some((l) => l.includes(" 28 tps \u00b7 0s \u00b7 \u2193 0 tokens")));

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
		const ctx = createContext([], [], undefined, { thinkingLevel: "high" });
		ctx.model = { provider: "anthropic", id: "claude-sonnet-4-5" } as NonNullable<ExtensionContext["model"]>;
		workingDecorator(extension.asAPI());

		const result = await extension.emit("input", { type: "input", text: "decorate this", source: "interactive" }, ctx);

		assert.deepEqual(result, { action: "handled" });
		assert.equal(extension.sentMessages.length, 1);
		const sent = extension.sentMessages[0] as {
			message: { customType: string; content: string; display: boolean; details: { submittedAt: number; showProvider?: boolean; showModel?: boolean; provider?: string; model?: string; thinkingLevel?: string } };
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
		assert.equal(sent.message.details.thinkingLevel, "high");
		assert.deepEqual(sent.options, { triggerTurn: true });
	});
});

test("known skill prompts get a display-only box while Pi handles the native invocation", async () => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, outputStyle: "explanatory" });
		const extension = new MockExtension({
			getCommands: () => [
				...DEFAULT_RUNTIME_COMMANDS,
				{ name: "skill:git-commit", source: "skill", sourceInfo: { path: "/skills/git-commit/SKILL.md" } },
			],
		});
		const ctx = createContext([], []);
		workingDecorator(extension.asAPI());
		const prompt = "/skill:git-commit Keep the commit focused";

		const result = await extension.emit("input", { type: "input", text: prompt, source: "interactive" }, ctx);

		assert.equal(result, undefined);
		assert.equal(extension.sentMessages.length, 0);
		assert.equal(extension.appendedEntries.length, 1);
		const entry = extension.appendedEntries[0]!;
		assert.equal(entry.customType, PROMPT_BOX_ENTRY_TYPE);
		const data = entry.data as PromptBoxEntryData;
		assert.equal(data.content, prompt);
		assert.equal(data.details.showIcon, true);

		const sections = { foo: "x" };
		const hook = await extension.emit("before_agent_start", beforeAgentStartEvent(sections), ctx);
		assert.deepEqual(sections, { foo: "x", [OUTPUT_STYLE_SECTION]: EXPLANATORY_SECTION });
		assert.deepEqual(hook, {
			message: { customType: OUTPUT_STYLE_MESSAGE_TYPE, content: EXPLANATORY_REMINDER, display: false },
		});

		const renderer = extension.entryRenderers[PROMPT_BOX_ENTRY_TYPE]!;
		const component = renderer(
			{ type: "custom", customType: PROMPT_BOX_ENTRY_TYPE, data },
			{ expanded: false },
			ctx.ui.theme,
		) as { render(width: number): string[] };
		assert.match(component.render(80).map(stripAnsi).join("\n"), /\/skill:git-commit Keep the commit focused/);
	});
});

test("only known skill commands get a skill prompt box", async () => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension({
			getCommands: () => [
				{ name: "skill:git-commit", source: "skill", sourceInfo: { path: "/skills/git-commit/SKILL.md" } },
			],
		});
		const ctx = createContext([], []);
		workingDecorator(extension.asAPI());

		for (const text of ["/skill:missing", "/skill:git-commit-extra", "/model"]) {
			const result = await extension.emit("input", { type: "input", text, source: "interactive" }, ctx);
			assert.equal(result, undefined, text);
		}

		assert.equal(extension.appendedEntries.length, 0);
		assert.equal(extension.sentMessages.length, 0);
	});
});

test("prompt box renderer paints the thinking-colored border from persisted details.thinkingLevel", async () => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`, { thinkingLevel: "high" });
		workingDecorator(extension.asAPI());

		const renderer = extension.messageRenderers[PROMPT_BOX_TYPE]!;
		const component = renderer(
			{ type: "custom", customType: PROMPT_BOX_TYPE, content: "persisted prompt", details: { borderColor: "thinking-level", thinkingLevel: "high" } },
			{ expanded: false },
			ctx.ui.theme,
		) as { render(width: number): string[] };

		assert.match(component.render(60)[0]!, /^<thinking-high>/);
	});
});

test("mid-stream input passes through so Pi's native queue UI renders", async () => {
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

			assert.equal(result, undefined);
		}

		assert.equal(extension.sentMessages.length, 0);
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

test("aborted settlement keeps turn details and overrides randomized marker text", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`, { thinkingLevel: "high" });
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		t.mock.method(Math, "random", () => 0);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(39, "served-model") }, ctx);
		await extension.emit("provider_stream_event", providerStreamEvent({ service_tier: "flex" }), ctx);
		await extension.emit("input", { type: "input", text: "more", source: "interactive", streamingBehavior: "steer" }, ctx);
		now = 6_000;
		await extension.emit("agent_settled", agentSettledEvent(true), ctx);

		const data = extension.appendedEntries[0]!.data;
		assert.deepEqual(data, {
			aborted: true, word: "Interrupted", elapsedMs: 5_000, tokens: 39, midTurnInputs: 1,
			serviceTiers: [{ tier: "flex", calls: 1 }], thinkingLevel: "high", model: "served-model",
		});
		const text = renderedDoneEntry(extension, ctx, data, 300);
		assert.match(text, /<warning>Interrupted<\/warning><dim> for 5s \(↓ 39 tokens · 1 mid-turn input · flex tier\)<\/dim>/);
		assert.match(text, /<muted>served-model<\/muted>/);
		assert.doesNotMatch(text, /<dim>[^<]*<warning>/);
	});
});

test("non-aborted settlement keeps the normal marker and stored entry shape", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, randomizeDoneMarker: false } });
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		await extension.emit("agent_settled", agentSettledEvent(false), ctx);
		const data = extension.appendedEntries[0]!.data as { word: string; aborted?: boolean };
		assert.equal(data.word, "Worked");
		assert.equal(Object.hasOwn(data, "aborted"), false);
		assert.match(renderedDoneEntry(extension, ctx, data), /Worked for 0s/);
	});
});

test("an older host without the abort field keeps the normal marker", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, randomizeDoneMarker: false } });
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		// Model the pre-1.1.0 runtime event without weakening the production type.
		const legacyEvent = { type: "agent_settled" } as AgentSettledEvent;
		await extension.emit("agent_settled", legacyEvent, ctx);
		const data = extension.appendedEntries[0]!.data as { word: string; aborted?: boolean };
		assert.equal(data.word, "Worked");
		assert.equal(Object.hasOwn(data, "aborted"), false);
	});
});

test("resumed aborted entries use the stored flag and warning border", async () => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, decorations: { ...DEFAULT_SETTINGS.decorations, doneMarkerBorderStyle: "heavy", doneMarkerBorderColor: "success" } });
		const extension = new MockExtension();
		const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`);
		workingDecorator(extension.asAPI());
		await extension.emit("session_start", { type: "session_start", reason: "resume" }, ctx);
		const text = renderedDoneEntry(extension, ctx, { aborted: true, word: "Interrupted", elapsedMs: 5_000, tokens: 39 }, 300);
		assert.match(text, /<warning>┗━━ /);
		assert.match(text, /<warning>Interrupted<\/warning><dim> for 5s \(↓ 39 tokens\)<\/dim>/);
		assert.doesNotMatch(text, /<success>/);
	});
});

test("interrupted markers stay warning colored without a border or icon", async () => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			features: { ...DEFAULT_SETTINGS.features, doneMarkerIcon: false },
			decorations: { ...DEFAULT_SETTINGS.decorations, doneMarkerBorderStyle: "none" },
		});
		const extension = new MockExtension();
		const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`);
		workingDecorator(extension.asAPI());
		const text = renderedDoneEntry(extension, ctx, { aborted: true, word: "Interrupted", elapsedMs: 5_000, tokens: 39 }, 300);
		assert.equal(text.trim(), "<warning>Interrupted</warning><dim> for 5s (↓ 39 tokens)</dim>");
	});
});

test("aborted settlement respects doneMarker=false", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, doneMarker: false } });
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		await extension.emit("agent_settled", agentSettledEvent(true), ctx);
		assert.equal(extension.appendedEntries.length, 0);
	});
});

test("aborted settlement still holds and fades the response-model footer", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, responseModelFooter: true } });
		const extension = new MockExtension();
		const statuses: { key: string; text: string | undefined }[] = [];
		const ctx = createContext([], [], truecolorThemeFg, { statuses });
		t.mock.method(Date, "now", () => 1_000);
		const { timers, cleared } = recordTimers(t);
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(39, "served-model") }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(true), ctx);
		assert.match(statuses.at(-1)!.text!, /served-model/);
		const hold = holdTimer(timers);
		assert.ok(hold);
		hold.tick();
		const fade = fadeTimer(timers, hold);
		assert.ok(fade);
		for (let i = 0; i < TOKEN_RATE_FADE_SHADE_COUNT; i++) fade.tick();
		assert.equal(statuses.at(-1)!.text, undefined);
		assert.ok(cleared.has(fade.id));
	});
});

test("agent_settled uses the matching past tense when the final working text is SimCity", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			features: { ...DEFAULT_SETTINGS.features },
			wordPacks: { simcity: true },
		});
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
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		assert.equal(extension.appendedEntries.length, 1);
		const entry = extension.appendedEntries[0]!;
		assert.equal(entry.customType, "pi-topping-done");
		const data = entry.data as { word: string; elapsedMs: number };
		assert.equal(data.word, "Zeroed");
		assert.equal(data.elapsedMs, 6 * 60_000 + 41_000);
	});
});

test("built-in completion marker matches the final working text", async (t) => {
	await withTempAgentDir(async () => {
		const newspaperIndex = WORDS.findIndex((word) => word.present_tense === "Newspapering");
		assert.ok(newspaperIndex >= 0, "expected Newspapering in the built-in word list");
		const newspaperRandom = (newspaperIndex + 0.5) / WORDS.length;
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, []);
		t.mock.method(Date, "now", () => 1_000);
		t.mock.method(Math, "random", () => newspaperRandom);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("input", { type: "input", text: "prompt", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		assert.match(stripAnsi(messages.at(-1)!), /^Newspapering/);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		const data = extension.appendedEntries[0]!.data as { word: string };
		assert.equal(data.word, "Newspapered");
	});
});

test("completion marker follows the last working-text source", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			features: { ...DEFAULT_SETTINGS.features },
			wordPacks: { simcity: true },
		});
		const extension = new MockExtension();
		const ctx = createContext([], []);
		const randomValues = [0, 0.999999, 0.999999, 0, 0.999999];
		t.mock.method(Date, "now", () => 1_000);
		t.mock.method(Math, "random", () => randomValues.shift() ?? 0.999999);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		// First turn: built-in prompt, then SimCity tool text => Zeroed.
		await extension.emit("input", { type: "input", text: "first", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("tool_execution_start", {
			type: "tool_execution_start",
			toolCallId: "tool-1",
			toolName: "read",
			args: {},
		}, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		// Second turn: SimCity prompt, then built-in tool text => its paired past tense.
		await extension.emit("input", { type: "input", text: "second", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("tool_execution_start", {
			type: "tool_execution_start",
			toolCallId: "tool-2",
			toolName: "read",
			args: {},
		}, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		const words = extension.appendedEntries.map((entry) => (entry.data as { word: string }).word);
		assert.deepEqual(words, ["Zeroed", "Accomplished"]);
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
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

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
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

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
		assert.equal(lines.length, 3);
		const text = lines.join("\n");
		assert.match(text, /<text><\/text>/);
		assert.match(text, /<dim> Baked for 6m 41s<\/dim>/);
	});
});

test("completion marker captures and renders the response model independently of the loader toggle", async (t) => {
	await withTempAgentDir(async () => {
		// Keep the marker word short and deterministic so the separator and model do not wrap at width 100.
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, responseModel: false, randomizeDoneMarker: false } });
		const extension = new MockExtension();
		const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("input", { type: "input", text: "prompt", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(39, "test-model") }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		const data = extension.appendedEntries[0]!.data as { model?: string };
		assert.equal(data.model, "test-model");
		const component = extension.entryRenderers["pi-topping-done"]!(
			{ type: "custom", customType: "pi-topping-done", data: extension.appendedEntries[0]!.data },
			{ expanded: false },
			ctx.ui.theme,
		) as { render(width: number): string[] };
		assert.match(component.render(100).join("\n"), /<dim> · <\/dim><muted>test-model<\/muted>/);
	});
});

test("provider response tiers are counted once per call and summarized in first-seen order", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);

		for (const tier of ["flex", "priority", "flex"]) {
			for (const type of ["response.created", "response.completed"]) {
				await extension.emit("provider_stream_event", providerStreamEvent({ type, response: { service_tier: tier } }), ctx);
			}
			await extension.emit("message_end", { type: "message_end", message: assistantMessage() }, ctx);
		}
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		const data = extension.appendedEntries[0]!.data as { serviceTiers?: { tier: string; calls: number }[] };
		assert.deepEqual(data.serviceTiers, [{ tier: "flex", calls: 2 }, { tier: "priority", calls: 1 }]);
		assert.match(renderedDoneEntry(extension, ctx, data), /· flex tier ×2, priority tier ×1\)/);
	});
});

test("the last raw tier reported by a provider call is the one summarized", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		await extension.emit("provider_stream_event", providerStreamEvent({ service_tier: "flex" }), ctx);
		await extension.emit("provider_stream_event", providerStreamEvent({ service_tier: "priority" }), ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage() }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		const data = extension.appendedEntries[0]!.data as { serviceTiers?: unknown };
		assert.deepEqual(data.serviceTiers, [{ tier: "priority", calls: 1 }]);
		const text = renderedDoneEntry(extension, ctx, data);
		assert.match(text, /· priority tier\)/);
		assert.ok(!text.includes("flex tier"));
	});
});

test("a call without a tier does not inherit the previous call's tier", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		for (const type of ["response.created", "response.completed"]) {
			await extension.emit("provider_stream_event", providerStreamEvent({ type, response: { service_tier: "flex" } }), ctx);
		}
		await extension.emit("message_end", { type: "message_end", message: assistantMessage() }, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage() }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		const data = extension.appendedEntries[0]!.data as { serviceTiers?: unknown };
		assert.deepEqual(data.serviceTiers, [{ tier: "flex", calls: 1 }]);
		assert.match(renderedDoneEntry(extension, ctx, data), /· flex tier\)/);
	});
});

test("Anthropic message_start raw tier is retained before Pi's normalized message_start", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		const message = assistantMessage();
		await extension.emit("provider_stream_event", providerStreamEvent(
			{ type: "message_start", message: { usage: { service_tier: "standard" } } }, "anthropic", "anthropic-messages",
		), ctx);
		await extension.emit("message_start", { type: "message_start", message }, ctx);
		await extension.emit("message_end", { type: "message_end", message }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		assert.deepEqual((extension.appendedEntries[0]!.data as { serviceTiers?: unknown }).serviceTiers, [{ tier: "standard", calls: 1 }]);
	});
});

test("idle provider events are ignored and service tiers reset between turns", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		const idle = providerStreamEvent({ response: { service_tier: "priority" } });
		await extension.emit("provider_stream_event", idle, ctx);
		await startTurn(extension, ctx, "first");
		await extension.emit("provider_stream_event", providerStreamEvent({ response: { service_tier: "flex" } }), ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		await extension.emit("provider_stream_event", idle, ctx);

		await startTurn(extension, ctx, "second");
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		const entries = extension.appendedEntries.map((entry) => entry.data as { serviceTiers?: unknown });
		assert.deepEqual(entries[0]!.serviceTiers, [{ tier: "flex", calls: 1 }]);
		assert.equal(Object.hasOwn(entries[1]!, "serviceTiers"), false);
	});
});

test("no reported service tier is omitted from the entry and marker", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(39) }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		const data = extension.appendedEntries[0]!.data as { serviceTiers?: unknown };
		assert.equal(Object.hasOwn(data, "serviceTiers"), false);
		const text = renderedDoneEntry(extension, ctx, data);
		assert.match(text, /↓ 39 tokens/);
		assert.ok(!text.includes("tier"));
	});
});

test("doneMarkerServiceTier=false hides the summary but keeps token details", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, doneMarkerServiceTier: false } });
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		await extension.emit("provider_stream_event", providerStreamEvent({ response: { service_tier: "flex" } }), ctx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(39) }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		const text = renderedDoneEntry(extension, ctx, extension.appendedEntries[0]!.data);
		assert.match(text, /↓ 39 tokens/);
		assert.ok(!text.includes("flex tier"));
	});
});

test("old and malformed service-tier entries render without tier text", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		for (const data of [
			{ word: "Baked", elapsedMs: 5_000 },
			{ word: "Whisked", elapsedMs: 5_000, serviceTiers: [null, { tier: "flex", calls: 0 }, { tier: "\u0000", calls: 1 }] },
		]) {
			const text = renderedDoneEntry(extension, ctx, data);
			assert.ok(!text.includes("tier"));
		}
	});
});

test("agent_settled commits a pending tier if message_end was not observed", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const ctx = createContext([], []);
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		await extension.emit("provider_stream_event", providerStreamEvent({ response: { service_tier: "flex" } }), ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		assert.deepEqual((extension.appendedEntries[0]!.data as { serviceTiers?: unknown }).serviceTiers, [{ tier: "flex", calls: 1 }]);
	});
});

test("Ramp Router Responses events show backend-only labels for models resembling the selection", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, responseModelFooter: true } });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		for (const [selectedId, servedModel, backend] of [
			["kimi-k3", "moonshotai/Kimi-K3", "baseten"],
			["deepseek-v4.1-flash", "accounts/fireworks/models/deepseek-v4p1-flash", "fireworks"],
		] as const) {
			const extension = new MockExtension();
			const messages: (string | undefined)[] = [];
			const statuses: { key: string; text: string | undefined }[] = [];
			const ctx = createContext(messages, [], undefined, {
				model: { provider: "ramp-router", id: selectedId, api: "openai-responses" },
				statuses,
			});
			workingDecorator(extension.asAPI());
			await startTurn(extension, ctx);
			await extension.emit("provider_stream_event", providerStreamEvent({
				type: "response.created",
					response: { model: servedModel },
					provider: backend,
			}, "ramp-router"), ctx);

			assert.match(stripAnsi(messages.at(-1)!), new RegExp(` · via ${backend}$`));
			await extension.emit("agent_settled", agentSettledEvent(), ctx);
			assert.equal((extension.appendedEntries[0]!.data as { model?: string }).model, `via ${backend}`);
			assert.match(stripAnsi(statuses.at(-1)!.text!), new RegExp(`via ${backend}`));
		}
	});
});

test("a Responses served model resembling the OpenAI selection stays hidden without a backend", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, responseModelFooter: true } });
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const statuses: { key: string; text: string | undefined }[] = [];
		const ctx = createContext(messages, [], undefined, {
			model: { provider: "openai", id: "openai/gpt-4.1-nano", api: "openai-responses" },
			statuses,
		});
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		await extension.emit("provider_stream_event", providerStreamEvent({
			type: "response.completed",
				response: { model: "gpt-4.1-nano-2025-04-14" },
		}, "openai"), ctx);

		assert.ok(!stripAnsi(messages.at(-1)!).includes("gpt-4.1-nano-2025-04-14"));
		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.equal((extension.appendedEntries[0]!.data as { model?: string }).model, undefined);
		assert.ok(statuses.every(({ text }) => text === undefined));
	});
});

test("served-model display keeps plain models and only adds a distinct backend", async (t) => {
	await withTempAgentDir(async () => {
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		for (const [servedModel, backend, expected] of [
			["gpt-4.1", undefined, "gpt-4.1"],
			["claude-sonnet-4-5", "ramp-router", "claude-sonnet-4-5"],
			["deepseek-v4.1", "baseten", "deepseek-v4.1 via baseten"],
		] as const) {
			const extension = new MockExtension();
			const messages: (string | undefined)[] = [];
			const ctx = createContext(messages, [], undefined, {
				model: { provider: "ramp-router", id: "selected-model", api: "openai-responses" },
			});
			workingDecorator(extension.asAPI());
			await startTurn(extension, ctx);
			await extension.emit("provider_stream_event", providerStreamEvent({
				response: { model: servedModel },
				...(backend ? { provider: backend } : {}),
			}, "ramp-router"), ctx);
			assert.ok(stripAnsi(messages.at(-1)!).endsWith(` · ${expected}`));
		}
	});
});

test("the Responses created/in_progress/completed sequence paints a model once", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, {
			model: { provider: "ramp-router", id: "selected-model", api: "openai-responses" },
		});
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		const before = messages.length;
		await extension.emit("provider_stream_event", providerStreamEvent({
			type: "response.created",
			response: { model: "served-model" },
			provider: "baseten",
		}, "ramp-router"), ctx);
		const afterCreated = messages.length;
		assert.equal(afterCreated, before + 1);

		for (const type of ["response.in_progress", "response.completed"]) {
			await extension.emit("provider_stream_event", providerStreamEvent({
				type,
				response: { model: "served-model" },
				provider: "baseten",
			}, "ramp-router"), ctx);
		}
		assert.equal(messages.length, afterCreated);
	});
});

test("a backend flip swaps in place without starting another loader slide", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, {
			model: { provider: "ramp-router", id: "selected-model", api: "openai-responses" },
		});
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		const { timers, cleared } = recordTimers(t);
		workingDecorator(extension.asAPI());
		extension.events.emit(CHANNELS.workingStatusEmbedded, { embedded: true });
		await startTurn(extension, ctx);
		await extension.emit("provider_stream_event", providerStreamEvent({
			type: "response.created",
			response: { model: "served-model" },
			provider: "baseten",
		}, "ramp-router"), ctx);
		const firstSlide = slideTimer(timers);
		assert.ok(firstSlide);

		now += RESPONSE_MODEL_SLIDE_FRAME_MS;
		firstSlide.tick();
		assert.ok(!cleared.has(firstSlide.id));
		await extension.emit("provider_stream_event", providerStreamEvent({
			type: "response.in_progress",
			response: { model: "served-model" },
			provider: "fireworks",
		}, "ramp-router"), ctx);
		assert.equal(slideTimer(timers), firstSlide);
		assert.equal(timers.filter((timer) => timer.ms === RESPONSE_MODEL_SLIDE_FRAME_MS).length, 1);
		assert.ok(!cleared.has(firstSlide.id));
		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		assert.equal((extension.appendedEntries[0]!.data as { model?: string }).model, "served-model via fireworks");
	});
});

test("idle and settled stream events are ignored, and the next turn starts clean", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, {
			model: { provider: "ramp-router", id: "selected-model", api: "openai-responses" },
		});
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		const event = (model: string, backend: string): ProviderStreamEvent => providerStreamEvent({
			response: { model },
			provider: backend,
		}, "ramp-router");

		await extension.emit("provider_stream_event", event("idle-model", "baseten"), ctx);
		await startTurn(extension, ctx, "first");
		assert.ok(!stripAnsi(messages.at(-1)!).includes("idle-model"));
		await extension.emit("provider_stream_event", event("turn-model", "baseten"), ctx);
		assert.match(stripAnsi(messages.at(-1)!), /turn-model via baseten$/);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		const afterSettle = messages.length;
		await extension.emit("provider_stream_event", event("late-model", "fireworks"), ctx);
		assert.equal(messages.length, afterSettle);

		await startTurn(extension, ctx, "second");
		assert.ok(!stripAnsi(messages.at(-1)!).includes("turn-model via baseten"));
	});
});

test("message lifecycle events do not clear a stream model in either order", async (t) => {
	await withTempAgentDir(async () => {
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		for (const streamFirst of [true, false]) {
			const extension = new MockExtension();
			const messages: (string | undefined)[] = [];
			const ctx = createContext(messages, [], undefined, {
				model: { provider: "ramp-router", id: "selected-model", api: "openai-responses" },
			});
			const message = assistantMessage();
			workingDecorator(extension.asAPI());
			await startTurn(extension, ctx);
			if (streamFirst) {
				await extension.emit("provider_stream_event", providerStreamEvent({
					response: { model: "served-model" },
					provider: "baseten",
				}, "ramp-router"), ctx);
			}
			await extension.emit("message_start", { type: "message_start", message }, ctx);
			await extension.emit("message_update", {
				type: "message_update",
				message,
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "text", partial: message },
			}, ctx);
			await extension.emit("message_end", { type: "message_end", message }, ctx);
			if (!streamFirst) {
				await extension.emit("provider_stream_event", providerStreamEvent({
					response: { model: "served-model" },
					provider: "baseten",
				}, "ramp-router"), ctx);
			}
			assert.match(stripAnsi(messages.at(-1)!), /served-model via baseten$/);
		}
	});
});

test("a same-model message report inherits the backend, while a different report replaces it", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, {
			model: { provider: "ramp-router", id: "kimi-k3", api: "openai-responses" },
		});
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		await extension.emit("provider_stream_event", providerStreamEvent({
			response: { model: "moonshotai/Kimi-K3" },
			provider: "baseten",
		}, "ramp-router"), ctx);
		const sameModelPaints = messages.length;
		await extension.emit("message_end", {
			type: "message_end",
			message: assistantMessage(0, "moonshotai/Kimi-K3"),
		}, ctx);
		assert.equal(messages.length, sameModelPaints);
		assert.match(stripAnsi(messages.at(-1)!), /via baseten$/);

		await extension.emit("message_end", {
			type: "message_end",
			message: assistantMessage(0, "deepseek-r1"),
		}, ctx);
		assert.ok(stripAnsi(messages.at(-1)!).endsWith(" · deepseek-r1"));
	});
});

test("a distinct route replaces a strong virtual-selection stream report", async (t) => {
	await withTempAgentDir(async () => {
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		for (const backend of [undefined, "baseten"] as const) {
			const extension = new MockExtension();
			const messages: (string | undefined)[] = [];
			const ctx = createContext(messages, [], undefined, { model: VIRTUAL_MODEL });
			workingDecorator(extension.asAPI());
			await startTurn(extension, ctx);
			extension.events.emit(CHANNELS.routedModel, routedModel("early-route"));
			assert.ok(stripAnsi(messages.at(-1)!).endsWith(" · early-route"));
			await extension.emit("provider_stream_event", providerStreamEvent({
				response: { model: "gpt-5.6-sol-2026-09-01" },
				...(backend ? { provider: backend } : {}),
			}, "routesense"), ctx);
			const expected = backend ? "gpt-5.6-sol-2026-09-01 via baseten" : "gpt-5.6-sol-2026-09-01";
			assert.ok(stripAnsi(messages.at(-1)!).endsWith(` · ${expected}`));

			const paints = messages.length;
			extension.events.emit(CHANNELS.routedModel, routedModel("gpt-5.6-sol", "continuation"));
			assert.equal(messages.length, paints + 1);
			assert.ok(stripAnsi(messages.at(-1)!).endsWith(" · gpt-5.6-sol"));
		}
	});
});

test("virtual failed routes stay hidden and openrouter auto routes remain visible", async (t) => {
	await withTempAgentDir(async () => {
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		const failedExtension = new MockExtension();
		const failedMessages: (string | undefined)[] = [];
		const failedCtx = createContext(failedMessages, [], undefined, { model: VIRTUAL_MODEL });
		workingDecorator(failedExtension.asAPI());
		await startTurn(failedExtension, failedCtx);
		await failedExtension.emit("provider_stream_event", providerStreamEvent({
			response: { model: "auto" },
		}, VIRTUAL_MODEL.provider), failedCtx);
		assert.ok(!stripAnsi(failedMessages.at(-1)!).includes(" · auto"));

		const routeExtension = new MockExtension();
		const routeMessages: (string | undefined)[] = [];
		const routeCtx = createContext(routeMessages, [], undefined, { model: VIRTUAL_MODEL });
		workingDecorator(routeExtension.asAPI());
		await startTurn(routeExtension, routeCtx);
		await routeExtension.emit("provider_stream_event", providerStreamEvent({
			response: { model: "auto" },
		}, "openrouter"), routeCtx);
		assert.ok(stripAnsi(routeMessages.at(-1)!).endsWith(" · auto"));
	});
});

test("chat-completions and Anthropic raw events do not alter the served-model display", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, {
			model: { provider: "ramp-router", id: "selected-model", api: "openai-responses" },
		});
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		await startTurn(extension, ctx);
		await extension.emit("provider_stream_event", providerStreamEvent({
			response: { model: "responses-model" },
			provider: "baseten",
		}, "ramp-router"), ctx);
		const before = messages.length;
		await extension.emit("provider_stream_event", providerStreamEvent({ model: "chat-model" }, "ramp-router", "openai-completions"), ctx);
		await extension.emit("provider_stream_event", providerStreamEvent({ message: { model: "claude-model" } }, "anthropic", "anthropic-messages"), ctx);
		assert.equal(messages.length, before);
		assert.ok(stripAnsi(messages.at(-1)!).endsWith("responses-model via baseten"));
	});
});

test("dimmed completion marker response model wraps the colored suffix", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, decorations: { ...DEFAULT_SETTINGS.decorations, doneMarkerModelDimmed: true } });
		const extension = new MockExtension();
		const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		const renderer = extension.entryRenderers["pi-topping-done"]!;
		const component = renderer(
			{ type: "custom", customType: "pi-topping-done", data: { word: "Gallivanted", elapsedMs: 5_000, tokens: 39, model: "test-model" } },
			{ expanded: false },
			ctx.ui.theme,
		) as { render(width: number): string[] };
		assert.match(component.render(100).join("\n"), /\x1b\[2m<muted>test-model<\/muted>\x1b\[22m/);
	});
});

test("completion marker model preview applies dimming independently of the loader toggle", () => {
	const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`, { thinkingLevel: "high" });
	const renderer = new PreviewRenderer(ctx);
	const state = { elapsedMs: 0, activeItemId: "doneMarkerModelDimmed", width: 300 };
	const dimmed = renderer.render({ doneMarker: true, doneMarkerModel: true, doneMarkerModelDimmed: true }, state);
	assert.ok(dimmed.lines.some((line) => line.includes("\x1b[2m") && line.includes("test-model")));
	const plain = renderer.render({ doneMarker: true, doneMarkerModel: true, doneMarkerModelDimmed: false }, state);
	assert.ok(plain.lines.some((line) => line.includes("test-model") && !line.includes("\x1b[2m")));
});

test("completion marker model uses its captured thinking level and can be hidden", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, decorations: { ...DEFAULT_SETTINGS.decorations, doneMarkerModelColor: "thinking-level" } });
		const extension = new MockExtension();
		const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`);
		mockTimers(t, () => {});
		workingDecorator(extension.asAPI());
		const renderer = extension.entryRenderers["pi-topping-done"]!;
		const rendered = renderer(
			{ type: "custom", customType: "pi-topping-done", data: { word: "Gallivanted", elapsedMs: 5_000, tokens: 39, model: "test-model", thinkingLevel: "high" } },
			{ expanded: false },
			ctx.ui.theme,
		) as { render(width: number): string[] };
		assert.match(rendered.render(300).join("\n"), /Gallivanted for 5s \(↓ 39 tokens\)<\/dim><dim> · <\/dim><thinking-high>test-model<\/thinking-high>/);

		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, doneMarkerModel: false } });
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		const hidden = renderer(
			{ type: "custom", customType: "pi-topping-done", data: { word: "Baked", elapsedMs: 5_000, tokens: 10, model: "test-model" } },
			{ expanded: false },
			ctx.ui.theme,
		) as { render(width: number): string[] };
		const text = hidden.render(100).join("\n");
		assert.match(text, /\(↓ 10 tokens\)/);
		assert.ok(!text.includes("test-model"));
	});
});

test("completion marker border style renders the selected decoration", async () => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			decorations: { ...DEFAULT_SETTINGS.decorations, doneMarkerBorderStyle: "heavy" },
		});

		const extension = new MockExtension();
		const ctx = createContext([], []);
		workingDecorator(extension.asAPI());
		const renderer = extension.entryRenderers["pi-topping-done"]!;
		const component = renderer(
			{ type: "custom", customType: "pi-topping-done", data: { word: "Mustered", elapsedMs: 4_000, tokens: 25 } },
			{ expanded: false },
			ctx.ui.theme,
		) as { render(width: number): string[] };

		const lines = component.render(54);
		assert.equal(lines.length, 3);
		assert.equal(lines[1], "┗━━  Mustered for 4s (↓ 25 tokens) ━━━━━━ ━━━━ ━━ ━");
	});
});

test("completion marker border color styles the decoration", async () => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			decorations: { ...DEFAULT_SETTINGS.decorations, doneMarkerBorderStyle: "heavy", doneMarkerBorderColor: "success" },
		});

		const extension = new MockExtension();
		const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`);
		workingDecorator(extension.asAPI());
		const renderer = extension.entryRenderers["pi-topping-done"]!;
		const component = renderer(
			{ type: "custom", customType: "pi-topping-done", data: { word: "Mustered", elapsedMs: 4_000, tokens: 25 } },
			{ expanded: false },
			ctx.ui.theme,
		) as { render(width: number): string[] };

		assert.match(component.render(200)[1]!, /<success>┗━━/);
	});
});

test("completion marker default border uses the active thinking level", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({
			...DEFAULT_SETTINGS,
			decorations: { ...DEFAULT_SETTINGS.decorations, doneMarkerBorderStyle: "heavy", doneMarkerBorderColor: "thinking-level" },
		});

		const extension = new MockExtension();
		const ctx = createContext([], [], (color, text) => `<${color}>${text}</${color}>`, { thinkingLevel: "high" });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("input", { type: "input", text: "prompt", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		const data = extension.appendedEntries[0]!.data as { thinkingLevel?: string };
		assert.equal(data.thinkingLevel, "high");
		const renderer = extension.entryRenderers["pi-topping-done"]!;
		const component = renderer(
			{ type: "custom", customType: "pi-topping-done", data },
			{ expanded: false },
			ctx.ui.theme,
		) as { render(width: number): string[] };

		assert.match(component.render(200)[1]!, /<thinking-high>┗━━/);
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
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

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
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		now = 50_000;
		await extension.emit("input", { type: "input", text: "fresh", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		now = 51_000;
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

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
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

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

test("a routesense announcement during a busy turn shows the routed model before any assistant message", async (t) => {
	await withTempAgentDir(async () => {
		saveSettings({ ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, responseModelFooter: true } });
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const statuses: { key: string; text: string | undefined }[] = [];
		const ctx = createContext(messages, [], undefined, { model: VIRTUAL_MODEL, statuses });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("input", { type: "input", text: "prompt", source: "interactive" }, ctx);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		assert.ok(!stripAnsi(messages.at(-1)!).includes("gpt-5.6-sol"));
		extension.events.emit(CHANNELS.routedModel, routedModel("gpt-5.6-sol"));
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/, "the announced model shows before message_start");

		await extension.emit("agent_settled", agentSettledEvent(), ctx);
		const data = extension.appendedEntries[0]!.data as { model?: string };
		assert.equal(data.model, "gpt-5.6-sol", "the completion marker records the announced model");
		assert.match(stripAnsi(statuses.at(-1)!.text!), /gpt-5\.6-sol/, "the response-model footer records the announced model");
	});
});

test("a bare routed id preserves only the matching provider-reported route", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, { model: VIRTUAL_MODEL });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		const routed = (responseModel?: string): AssistantMessage => ({ ...assistantMessage(0, responseModel), provider: "openai-codex", model: "gpt-5.6-sol" });
		const update = async (partial: AssistantMessage): Promise<void> => {
			await extension.emit("message_update", {
				type: "message_update",
				message: partial,
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "", partial },
			}, ctx);
		};

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		extension.events.emit(CHANNELS.routedModel, routedModel("gpt-5.6-sol"));
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/);
		await extension.emit("message_start", { type: "message_start", message: routed() }, ctx);
		await update(routed("gpt-5.6-sol-2026-09-01"));
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol-2026-09-01$/, "the provider's dated form replaces the bare id");
		await extension.emit("message_end", { type: "message_end", message: routed("gpt-5.6-sol-2026-09-01") }, ctx);

		await extension.emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "1", toolName: "read", args: {} }, ctx);
		const painted = messages.length;
		extension.events.emit(CHANNELS.routedModel, routedModel("gpt-5.6-sol", "continuation"));
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol-2026-09-01$/, "the continuation announcement keeps the dated form");
		await extension.emit("message_start", { type: "message_start", message: routed() }, ctx);
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol-2026-09-01$/, "the message's bare model keeps the dated form");
		assert.equal(messages.length, painted, "neither bare id repaints the loader");
		await update(routed("gpt-5.6-sol-2026-09-01"));
		assert.equal(messages.length, painted, "the dated form reported again does not repaint either");

		extension.events.emit(CHANNELS.routedModel, routedModel("gpt-5.6-sol-2026"));
		assert.ok(stripAnsi(messages.at(-1)!).endsWith(" · gpt-5.6-sol-2026"), "a distinct but similar route replaces the decorated form");
	});
});

test("a bare routed id that does not resemble the shown model still swaps in place", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, { model: VIRTUAL_MODEL });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		extension.events.emit(CHANNELS.routedModel, routedModel("gpt-5.6-sol"));
		await extension.emit("message_end", {
			type: "message_end",
			message: { ...assistantMessage(0, "gpt-5.6-sol-2026-09-01"), provider: "openai-codex", model: "gpt-5.6-sol" },
		}, ctx);
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol-2026-09-01$/);

		extension.events.emit(CHANNELS.routedModel, routedModel("claude-opus-5-5", "retry", "anthropic"));
		assert.match(stripAnsi(messages.at(-1)!), / · claude-opus-5-5$/, "a retry's fallback model replaces the dated form");
		await extension.emit("message_start", {
			type: "message_start",
			message: { ...assistantMessage(0), provider: "openai-codex", model: "gpt-5.6-sol" },
		}, ctx);
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/, "a message's bare model that differs from the shown one replaces it");
	});
});

test("under a virtual selection only the failed-route virtual model itself is hidden", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, { model: VIRTUAL_MODEL });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		await extension.emit("message_end", { type: "message_end", message: { ...assistantMessage(0), provider: "openrouter", model: "auto" } }, ctx);
		assert.match(stripAnsi(messages.at(-1)!), / · auto$/, "a routed model whose id contains the virtual id shows");

		await extension.emit("message_end", { type: "message_end", message: { ...assistantMessage(0), provider: "openai-codex", model: "gpt-5.6-sol" } }, ctx);
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/);
		extension.events.emit(CHANNELS.routedModel, routedModel("auto", "continuation", "openrouter"));
		assert.match(stripAnsi(messages.at(-1)!), / · auto$/, "an announcement of such a model shows");

		await extension.emit("message_end", { type: "message_end", message: { ...assistantMessage(0), provider: "openai-codex", model: "gpt-5.6-sol" } }, ctx);
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/);
		await extension.emit("message_end", { type: "message_end", message: { ...assistantMessage(0), provider: VIRTUAL_MODEL.provider, model: VIRTUAL_MODEL.id } }, ctx);
		assert.ok(!/ · (auto|gpt-5\.6-sol)$/.test(stripAnsi(messages.at(-1)!)), "a failed route reports the virtual model itself, which is hidden");
	});
});

test("direct-route routesense announcements are ignored", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, { model: VIRTUAL_MODEL });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		const before = messages.length;
		extension.events.emit(CHANNELS.routedModel, routedModel("gpt-5.6-sol", "direct"));
		assert.equal(messages.length, before);
		assert.ok(!stripAnsi(messages.at(-1)!).includes("gpt-5.6-sol"));

		extension.events.emit(CHANNELS.routedModel, routedModel("gpt-5.6-sol", "retry"));
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/, "other route reasons still show");
	});
});

test("malformed routesense announcements are ignored", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, { model: VIRTUAL_MODEL });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		const before = messages.length;
		extension.events.emit(CHANNELS.routedModel, { ...routedModel("gpt-5.6-sol"), version: 2 });
		assert.equal(messages.length, before);
		assert.ok(!stripAnsi(messages.at(-1)!).includes("gpt-5.6-sol"));
	});
});

test("a routesense announcement while the loader is idle is ignored", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, { model: VIRTUAL_MODEL });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("session_start", { type: "session_start", reason: "startup" }, ctx);
		extension.events.emit(CHANNELS.routedModel, routedModel("gpt-5.6-sol"));
		assert.equal(messages.length, 0);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		assert.ok(!stripAnsi(messages.at(-1)!).includes("gpt-5.6-sol"), "a background route leaves no stale model for the next turn");
		await extension.emit("agent_settled", agentSettledEvent(), ctx);

		const settled = messages.length;
		extension.events.emit(CHANNELS.routedModel, routedModel("gpt-5.6-sol"));
		assert.equal(messages.length, settled);
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		assert.ok(!stripAnsi(messages.at(-1)!).includes("gpt-5.6-sol"));
	});
});

test("assistant messages without a responseModel keep the announced model, and a reported one replaces it", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, { model: VIRTUAL_MODEL });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});
		const update = async (partial: AssistantMessage): Promise<void> => {
			await extension.emit("message_update", {
				type: "message_update",
				message: partial,
				assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "", partial },
			}, ctx);
		};

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		extension.events.emit(CHANNELS.routedModel, routedModel("gpt-5.6-sol"));
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/);

		await extension.emit("message_start", { type: "message_start", message: { role: "assistant" } }, ctx);
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/, "message_start without a responseModel keeps the announced model");
		await update({ ...assistantMessage(0), model: "gpt-5.6-sol" });
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/, "message_update without a responseModel keeps the announced model");
		await extension.emit("message_end", { type: "message_end", message: { ...assistantMessage(0), model: "gpt-5.6-sol" } }, ctx);
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/, "message_end without a responseModel keeps the announced model");

		await update({ ...assistantMessage(0, "gpt-5.6-sol-2026-09-01"), model: "gpt-5.6-sol" });
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol-2026-09-01$/, "a provider-reported responseModel replaces it");
	});
});

test("a continuation announcement naming a different model swaps in place", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const ctx = createContext(messages, [], undefined, { model: VIRTUAL_MODEL });
		let now = 1_000;
		t.mock.method(Date, "now", () => now);
		const { timers } = recordTimers(t);

		workingDecorator(extension.asAPI());
		extension.events.emit(CHANNELS.workingStatusEmbedded, { embedded: true });
		await extension.emit("agent_start", { type: "agent_start" }, ctx);
		extension.events.emit(CHANNELS.routedModel, routedModel("gpt-5.6-sol"));
		const firstSlide = slideTimer(timers);
		assert.ok(firstSlide, "an announced model slides out like a reported one");
		now += WORKING_STATUS_SLIDE_MS;
		firstSlide.tick();
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/);

		extension.events.emit(CHANNELS.routedModel, routedModel("claude-opus-5-5", "continuation"));
		assert.match(stripAnsi(messages.at(-1)!), / · claude-opus-5-5$/, "the continuation's model shows whole at once");
		assert.equal(slideTimer(timers), firstSlide, "without starting another slide");
	});
});

test("under a virtual selection the assistant message's model stands in for a missing responseModel", async (t) => {
	await withTempAgentDir(async () => {
		const extension = new MockExtension();
		const messages: (string | undefined)[] = [];
		const virtualCtx = createContext(messages, [], undefined, { model: VIRTUAL_MODEL });
		t.mock.method(Date, "now", () => 1_000);
		mockTimers(t, () => {});

		workingDecorator(extension.asAPI());
		await extension.emit("agent_start", { type: "agent_start" }, virtualCtx);
		await extension.emit("message_start", { type: "message_start", message: { ...assistantMessage(0), model: "gpt-5.6-sol" } }, virtualCtx);
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/, "message_start falls back to the routed model");

		const partial = { ...assistantMessage(0), model: "claude-opus-5-5" };
		await extension.emit("message_update", {
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "", partial },
		}, virtualCtx);
		assert.match(stripAnsi(messages.at(-1)!), / · claude-opus-5-5$/, "message_update falls back to the partial's model");
		await extension.emit("message_end", { type: "message_end", message: { ...assistantMessage(0), model: "gpt-5.6-sol" } }, virtualCtx);
		assert.match(stripAnsi(messages.at(-1)!), / · gpt-5\.6-sol$/, "message_end falls back to the routed model");

		await extension.emit("message_end", { type: "message_end", message: { ...assistantMessage(0), provider: "routesense", model: "auto" } }, virtualCtx);
		assert.ok(!stripAnsi(messages.at(-1)!).includes("auto"), "a failed route leaves the virtual model on the message, which is hidden");
		await extension.emit("agent_settled", agentSettledEvent(), virtualCtx);

		const physicalCtx = createContext(messages, [], undefined, { selectedModel: "test" });
		await extension.emit("agent_start", { type: "agent_start" }, physicalCtx);
		const before = messages.length;
		await extension.emit("message_start", { type: "message_start", message: assistantMessage(0) }, physicalCtx);
		await extension.emit("message_end", { type: "message_end", message: assistantMessage(0) }, physicalCtx);
		assert.equal(messages.length, before, "a physical selection never falls back to the message's model");
		assert.ok(!stripAnsi(messages.at(-1)!).includes(" · test"));
	});
});
