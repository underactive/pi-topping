import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { hyperlink } from "@earendil-works/pi-tui";
import { type MenuValue, showMenu } from "./menu.ts";
import { type PiInstallResult, spawnPiInstall, spawnPiRemove } from "./pi-installer.ts";
import { setSetupCheckDisabled } from "./setup-check.ts";
import { detectToppings, type ToppingStatus } from "./toppings.ts";
import { stripControlChars } from "./util.ts";

const PI_COMMAND_TIMEOUT_MS = 120_000;
const STDERR_SNIPPET_CHARS = 300;

type PackageAction = "install" | "remove";
type PiPackageRunner = (spec: string, timeoutMs: number) => Promise<PiInstallResult>;
type FailedAction = { action: PackageAction; spec: string; error: string };
type SetupRow = { status: ToppingStatus; action: PackageAction };

function selectedRows(
	rows: ReadonlyMap<string, SetupRow>,
	values: Record<string, boolean>,
	action: PackageAction,
): ToppingStatus[] {
	return [...rows.entries()]
		.filter(([id, row]) => row.action === action && values[id] === true)
		.map(([, row]) => row.status);
}

function renderDescription(
	rows: ReadonlyMap<string, SetupRow>,
	activeItemId: string | undefined,
	values: Record<string, MenuValue>,
): string[] {
	if (activeItemId === undefined) return ["Select a topping to see what it does."];
	const active = rows.get(activeItemId);
	if (!active) return ["Select a topping to see what it does."];
	const url = `https://pi.dev/packages/${active.status.topping.pkg}`;
	const action = values[activeItemId] === true
		? `Checked: will ${active.action === "install" ? "install" : "uninstall"}`
		: "Unchecked: no change";
	return [active.status.topping.provides, "", hyperlink(url, url), "", action];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function snippet(text: string): string {
	return stripControlChars(text.trim()).slice(0, STDERR_SNIPPET_CHARS);
}

function buildReport(installed: string[], removed: string[], failed: FailedAction[]): string {
	const lines: string[] = [];
	if (installed.length > 0) lines.push(`✓ Installed: ${installed.join(", ")}`);
	if (removed.length > 0) lines.push(`✓ Removed: ${removed.join(", ")}`);
	if (failed.length > 0) {
		lines.push("✗ Failed:");
		for (const failure of failed) lines.push(`  ${failure.action} ${failure.spec}: ${failure.error}`);
	}
	if (installed.length > 0 || removed.length > 0) {
		lines.push("");
		lines.push("Restart Pi afterwards to apply the changes.");
	}
	return lines.join("\n");
}

async function runPackageCommands(
	ctx: ExtensionCommandContext,
	selected: readonly ToppingStatus[],
	runner: PiPackageRunner,
	action: PackageAction,
): Promise<{ succeeded: string[]; failed: FailedAction[] }> {
	const succeeded: string[] = [];
	const failed: FailedAction[] = [];
	for (const { topping } of selected) {
		const spec = `npm:${topping.pkg}`;
		ctx.ui.notify(`${action === "install" ? "Installing" : "Removing"} ${spec}…`, "info");
		try {
			const result = await runner(spec, PI_COMMAND_TIMEOUT_MS);
			if (result.code === 0) {
				succeeded.push(spec);
			} else {
				failed.push({ action, spec, error: snippet(result.stderr || result.stdout || `exit ${result.code}`) });
			}
		} catch (error) {
			failed.push({ action, spec, error: snippet(errorMessage(error)) });
		}
	}
	return { succeeded, failed };
}

export function registerSetupCommand(
	pi: ExtensionAPI,
	install: PiPackageRunner = spawnPiInstall,
	remove: PiPackageRunner = spawnPiRemove,
): void {
	pi.registerCommand("topping-setup", {
		description: "Install or uninstall Pi Topping sibling extensions or manage the missing-extension notice.",
		handler: async (args, ctx) => {
			const action = args.trim();
			if (action === "disable-side-toppings-check" || action === "enable-side-toppings-check") {
				try {
					const disabled = action === "disable-side-toppings-check";
					setSetupCheckDisabled(disabled);
					ctx.ui.notify(
						disabled
							? "Missing topping check disabled. Run `/topping-setup enable-side-toppings-check` to re-enable it."
							: "Missing topping check enabled.",
						"info",
					);
				} catch {
					ctx.ui.notify(`Failed to ${action === "disable-side-toppings-check" ? "disable" : "enable"} the missing topping check.`, "error");
				}
				return;
			}
			if (action) {
				ctx.ui.notify("Usage: /topping-setup [disable-side-toppings-check|enable-side-toppings-check]", "error");
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify("/topping-setup requires TUI mode", "error");
				return;
			}

			const statuses = detectToppings(pi);
			const removable = statuses.filter((status) => status.packageSource !== undefined);
			const missing = statuses.filter((status) => !status.active && status.packageSource === undefined);
			if (missing.length === 0 && removable.length === 0) {
				ctx.ui.notify("All Pi Topping extensions are already active in this session.", "info");
				return;
			}

			const rows = new Map<string, SetupRow>();
			for (const status of missing) rows.set(`install:${status.topping.pkg}`, { status, action: "install" });
			for (const status of removable) rows.set(`remove:${status.topping.pkg}`, { status, action: "remove" });
			const sections = [];
			if (missing.length > 0) {
				sections.push({
					title: "Missing Toppings",
					items: missing.map(({ topping, onDisk }) => ({
						id: `install:${topping.pkg}`,
						label: `${topping.pkg}${onDisk ? " (on disk, not active)" : ""}`,
						value: true,
					})),
				});
			}
			if (removable.length > 0) {
				sections.push({
					title: "Installed Toppings",
					items: removable.map(({ topping, active }) => ({
						id: `remove:${topping.pkg}`,
						label: `${topping.pkg}${active ? " (active)" : " (installed, not active)"}`,
						value: false,
					})),
				});
			}

			const result = await showMenu<Record<string, boolean>>(ctx, {
				title: "Pi Topping: Setup",
				sections,
				hints: ["↑↓ move", "PgUp/PgDn page", "␣ toggle", "⏎ apply", "esc cancel"],
				previewTitle: "Description",
				preview: (values, _elapsedMs, activeItemId) => ({ lines: renderDescription(rows, activeItemId, values) }),
			});
			if (!result.applied) {
				ctx.ui.notify("Pi Topping setup cancelled.", "info");
				return;
			}

			const removals = selectedRows(rows, result.values, "remove");
			const installs = selectedRows(rows, result.values, "install");
			if (removals.length === 0 && installs.length === 0) {
				ctx.ui.notify("No Pi Topping changes selected.", "info");
				return;
			}

			const removalResult = await runPackageCommands(ctx, removals, remove, "remove");
			const installResult = await runPackageCommands(ctx, installs, install, "install");
			const failed = [...removalResult.failed, ...installResult.failed];
			ctx.ui.notify(buildReport(installResult.succeeded, removalResult.succeeded, failed), failed.length > 0 ? "warning" : "info");
		},
	});
}
