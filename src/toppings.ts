import { getAgentDir, type ExtensionAPI, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isSetupCheckDisabled } from "./setup-check.ts";
import { isPlainObject } from "./util.ts";

export interface Topping {
	readonly pkg: string;
	readonly matches: RegExp;
	readonly dir: string;
	readonly command: string;
	readonly provides: string;
}

export interface ToppingStatus {
	readonly topping: Topping;
	readonly active: boolean;
	readonly onDisk: boolean;
}

export const TOPPINGS: readonly Topping[] = [
	{
		pkg: "@underactive/pi-topping-statusline",
		matches: /pi-topping-statusline/i,
		dir: "pi-topping-statusline",
		command: "topping-statusline-settings",
		provides: "status line customization",
	},
	{
		pkg: "@underactive/pi-topping-splash",
		matches: /pi-topping-splash/i,
		dir: "pi-topping-splash",
		command: "topping-splash-settings",
		provides: "startup splash screen",
	},
	{
		pkg: "@underactive/pi-topping-persona-audit",
		matches: /pi-topping-persona-audit/i,
		dir: "pi-topping-persona-audit",
		command: "persona-audit",
		provides: "persona audit tools",
	},
	{
		pkg: "@underactive/pi-topping-web-tools",
		matches: /pi-topping-web-tools/i,
		dir: "pi-topping-web-tools",
		command: "browser",
		provides: "web research and browser automation",
	},
];

interface PiSettings {
	packages?: unknown;
	extensions?: unknown;
}

interface SettingsToppingState {
	packageInstalled: boolean;
	extensionPresent: boolean;
	extensionActive: boolean;
}

let setupNoticeHandled = false;

function stringEntries(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function readPiSettings(): PiSettings | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf8"));
		return isPlainObject(parsed) ? parsed as PiSettings : undefined;
	} catch {
		return undefined;
	}
}

function extensionEntry(entry: string): { value: string; disabled: boolean } {
	const value = entry.trim();
	if (value.startsWith("+") || value.startsWith("-")) return { value: value.slice(1), disabled: value.startsWith("-") };
	return { value, disabled: false };
}

function settingsState(settings: PiSettings | undefined, topping: Topping): SettingsToppingState {
	let packageInstalled = false;
	let extensionPresent = false;
	let extensionActive = false;
	for (const entry of stringEntries(settings?.packages)) {
		if (topping.matches.test(entry)) packageInstalled = true;
	}
	for (const entry of stringEntries(settings?.extensions)) {
		const normalized = extensionEntry(entry);
		if (!topping.matches.test(normalized.value)) continue;
		extensionPresent = true;
		if (!normalized.disabled) extensionActive = true;
	}
	return { packageInstalled, extensionPresent, extensionActive };
}

function runtimeActiveToppings(pi: ExtensionAPI): Array<true | undefined> | undefined {
	try {
		const commands = pi.getCommands();
		return TOPPINGS.map((topping) =>
			commands.some((command) =>
				command.source === "extension" && topping.matches.test(command.sourceInfo.path),
			)
				? true
				: undefined,
		);
	} catch {
		// The extension runtime has not yet been bound during initial load.
		return undefined;
	}
}

export function detectToppings(pi: ExtensionAPI): ToppingStatus[] {
	const runtime = runtimeActiveToppings(pi);
	const settings = readPiSettings();
	const extensionsDir = join(getAgentDir(), "extensions");
	return TOPPINGS.map((topping, index) => {
		const configured = settingsState(settings, topping);
		const checkoutPresent = existsSync(join(extensionsDir, topping.dir));
		const onDisk = configured.packageInstalled || configured.extensionPresent || checkoutPresent;
		const fallbackActive = configured.packageInstalled || configured.extensionActive || checkoutPresent;
		return { topping, active: runtime?.[index] ?? fallbackActive, onDisk };
	});
}

export function findMissingToppings(pi: ExtensionAPI): ToppingStatus[] {
	return detectToppings(pi).filter((status) => !status.active);
}

function renderMissingBanner(missing: readonly ToppingStatus[]): string {
	const title = `pi-topping: ${missing.length} topping extensions missing`;
	const body = [
		...missing.map(({ topping }) => `• ${topping.pkg} — ${topping.provides}`),
		"",
		"Run `/topping-setup` to selectively install them",
		"Run `/topping-setup disable-side-toppings-check` to suppress this message",
	];
	const width = Math.max(title.length + 6, ...body.map((line) => line.length + 4));
	const blankRow = `│${" ".repeat(width - 2)}│`;
	return [
		`╭─ ${title} ${"─".repeat(width - title.length - 5)}╮`,
		blankRow,
		...body.map((line) => `│ ${line.padEnd(width - 4)} │`),
		blankRow,
		`╰${"─".repeat(width - 2)}╯`,
	].join("\n");
}

export function notifyMissingToppingsOnce(pi: ExtensionAPI, ui: Pick<ExtensionUIContext, "notify">): void {
	if (setupNoticeHandled) return;
	setupNoticeHandled = true;
	if (isSetupCheckDisabled()) return;
	const missing = findMissingToppings(pi);
	if (missing.length > 0) ui.notify(`\n${renderMissingBanner(missing)}`, "warning");
}

/** Test-only reset for the once-per-process session-start notice. */
export function __resetSetupNotice(): void {
	setupNoticeHandled = false;
}
