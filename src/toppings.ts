import { getAgentDir, type CustomEntry, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isSetupCheckDisabled } from "./setup-check.ts";
import { isPlainObject } from "./util.ts";

export interface Topping {
	readonly pkg: string;
	readonly matches: RegExp;
	readonly dir: string;
	readonly provides: string;
}

export interface ToppingStatus {
	readonly topping: Topping;
	readonly active: boolean;
	readonly onDisk: boolean;
	/** Exact npm source recorded in Pi's user settings for this topping. */
	readonly packageSource: string | undefined;
}

export const TOPPINGS: readonly Topping[] = [
	{
		pkg: "@underactive/pi-topping-statusline",
		matches: /pi-topping-statusline/i,
		dir: "pi-topping-statusline",
		provides: "status line customization",
	},
	{
		pkg: "@underactive/pi-topping-splash",
		matches: /pi-topping-splash/i,
		dir: "pi-topping-splash",
		provides: "startup splash screen",
	},
	{
		pkg: "@underactive/pi-topping-persona-audit",
		matches: /pi-topping-persona-audit/i,
		dir: "pi-topping-persona-audit",
		provides: "persona audit tools",
	},
	{
		pkg: "@underactive/pi-topping-web-tools",
		matches: /pi-topping-web-tools/i,
		dir: "pi-topping-web-tools",
		provides: "web research and browser automation",
	},
	{
		pkg: "@underactive/pi-topping-moa-fusion",
		matches: /pi-topping-moa-fusion/i,
		dir: "pi-topping-moa-fusion",
		provides: "Mixture-of-Agents Fusion plan mode",
	},
];

interface PiSettings {
	packages?: unknown;
	extensions?: unknown;
}

interface SettingsToppingState {
	packageInstalled: boolean;
	packageSource?: string;
	extensionPresent: boolean;
	extensionActive: boolean;
}

export const SETUP_ENTRY_TYPE = "pi-topping-setup";

export interface MissingToppingsEntryData {
	readonly toppings: ReadonlyArray<Pick<Topping, "pkg" | "provides">>;
}

let setupNoticeHandled = false;

function stringEntries(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function sourceEntries(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		if (typeof entry === "string") return [entry];
		return isPlainObject(entry) && typeof entry.source === "string" ? [entry.source] : [];
	});
}

function npmPackageName(source: string): string | undefined {
	const value = source.trim();
	if (!value.startsWith("npm:")) return undefined;
	const spec = value.slice("npm:".length);
	const versionIndex = spec.lastIndexOf("@");
	return versionIndex > 0 ? spec.slice(0, versionIndex) : spec;
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
	let packageSource: string | undefined;
	let extensionPresent = false;
	let extensionActive = false;
	for (const entry of sourceEntries(settings?.packages)) {
		if (topping.matches.test(entry)) packageInstalled = true;
		if (npmPackageName(entry) === topping.pkg) packageSource = entry;
	}
	for (const entry of stringEntries(settings?.extensions)) {
		const normalized = extensionEntry(entry);
		if (!topping.matches.test(normalized.value)) continue;
		extensionPresent = true;
		if (!normalized.disabled) extensionActive = true;
	}
	return { packageInstalled, packageSource, extensionPresent, extensionActive };
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
		return { topping, active: runtime?.[index] ?? fallbackActive, onDisk, packageSource: configured.packageSource };
	});
}

export function findMissingToppings(pi: ExtensionAPI): ToppingStatus[] {
	return detectToppings(pi).filter((status) => !status.active);
}

function renderMissingToppings(
	toppings: MissingToppingsEntryData["toppings"],
	theme: Pick<Theme, "fg">,
	width: number,
): string[] {
	const safeWidth = Math.max(0, width);
	const text = (value: string): string => theme.fg("text", value);
	const accent = (value: string): string => theme.fg("accent", value);
	const fit = (line: string): string => truncateToWidth(line, safeWidth, "");
	const rule = theme.fg("warning", "─".repeat(safeWidth));
	return [
		rule,
		fit(text(`pi-topping: ${toppings.length} topping extension${toppings.length === 1 ? "" : "s"} missing`)),
		"",
		...toppings.map(({ pkg, provides }) => fit(`${text("• ")}${accent(pkg)}${text(` — ${provides}`)}`)),
		"",
		fit(`${text("Run ")}${accent("/topping-setup")}${text(" to selectively install them")}`),
		fit(`${text("Run ")}${accent("/topping-setup disable-side-toppings-check")}${text(" to suppress this message")}`),
		rule,
	];
}

export function renderMissingToppingsEntry(
	entry: CustomEntry<MissingToppingsEntryData>,
	theme: Theme,
): Component | undefined {
	if (!entry.data || !Array.isArray(entry.data.toppings)) return undefined;
	let cachedWidth: number | undefined;
	let cachedLines: string[] | undefined;
	return {
		render(width: number): string[] {
			if (cachedWidth !== width) {
				cachedWidth = width;
				cachedLines = renderMissingToppings(entry.data!.toppings, theme, width);
			}
			return cachedLines!;
		},
		invalidate(): void {
			cachedWidth = undefined;
			cachedLines = undefined;
		},
	};
}

export function announceMissingToppingsOnce(pi: ExtensionAPI): void {
	if (setupNoticeHandled) return;
	setupNoticeHandled = true;
	if (isSetupCheckDisabled()) return;
	const missing = findMissingToppings(pi);
	if (missing.length > 0) {
		pi.appendEntry<MissingToppingsEntryData>(SETUP_ENTRY_TYPE, {
			toppings: missing.map(({ topping }) => ({ pkg: topping.pkg, provides: topping.provides })),
		});
	}
}

/** Test-only reset for the once-per-process session-start notice. */
export function __resetSetupNotice(): void {
	setupNoticeHandled = false;
}
