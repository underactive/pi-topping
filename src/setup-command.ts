import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { hyperlink } from "@earendil-works/pi-tui";
import { showMenu } from "./menu.ts";
import { type PiInstallResult, spawnPiInstall } from "./pi-installer.ts";
import { stripControlChars } from "./util.ts";
import { setSetupCheckDisabled } from "./setup-check.ts";
import { findMissingToppings, type ToppingStatus } from "./toppings.ts";

const INSTALL_TIMEOUT_MS = 120_000;
const STDERR_SNIPPET_CHARS = 300;

type ToppingInstaller = (spec: string, timeoutMs: number) => Promise<PiInstallResult>;

type FailedInstall = { spec: string; error: string };

function selectedToppings(missing: readonly ToppingStatus[], values: Record<string, boolean>): ToppingStatus[] {
	return missing.filter(({ topping }) => values[topping.pkg] === true);
}

function renderDescription(missing: readonly ToppingStatus[], activeItemId: string | undefined): string[] {
	const active = missing.find(({ topping }) => topping.pkg === activeItemId);
	if (!active) return ["Select a topping to see what it does."];
	const url = `https://pi.dev/packages/${active.topping.pkg}`;
	return [active.topping.provides, "", hyperlink(url, url)];
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function buildReport(succeeded: string[], failed: FailedInstall[]): string {
	const lines: string[] = [];
	if (succeeded.length > 0) lines.push(`✓ Installed: ${succeeded.join(", ")}`);
	if (failed.length > 0) {
		lines.push("✗ Failed:");
		for (const failure of failed) lines.push(`  ${failure.spec}: ${failure.error}`);
	}
	if (succeeded.length > 0) {
		lines.push("");
		lines.push("Restart Pi afterwards to activate them.");
	}
	return lines.join("\n");
}

async function installSelected(
	ctx: ExtensionCommandContext,
	selected: readonly ToppingStatus[],
	install: ToppingInstaller,
): Promise<{ succeeded: string[]; failed: FailedInstall[] }> {
	const succeeded: string[] = [];
	const failed: FailedInstall[] = [];
	for (const { topping } of selected) {
		const spec = `npm:${topping.pkg}`;
		ctx.ui.notify(`Installing ${spec}…`, "info");
		try {
			const result = await install(spec, INSTALL_TIMEOUT_MS);
			if (result.code === 0) {
				succeeded.push(spec);
			} else {
				failed.push({ spec, error: stripControlChars((result.stderr || result.stdout || `exit ${result.code}`).trim()).slice(0, STDERR_SNIPPET_CHARS) });
			}
		} catch (error) {
			failed.push({ spec, error: stripControlChars(errorMessage(error)).slice(0, STDERR_SNIPPET_CHARS) });
		}
	}
	return { succeeded, failed };
}

export function registerSetupCommand(pi: ExtensionAPI, install: ToppingInstaller = spawnPiInstall): void {
	pi.registerCommand("topping-setup", {
		description: "Install missing Pi Topping sibling extensions or manage the missing-extension notice.",
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

			const missing = findMissingToppings(pi);
			if (missing.length === 0) {
				ctx.ui.notify("All Pi Topping extensions are already active in this session.", "info");
				return;
			}

			const result = await showMenu<Record<string, boolean>>(ctx, {
				title: "Pi Topping: Setup",
				sections: [
					{
						title: "Missing Toppings",
						items: missing.map(({ topping, onDisk }) => ({
							id: topping.pkg,
							label: `${topping.pkg}${onDisk ? " (on disk, not active)" : ""}`,
							value: true,
						})),
					},
				],
				hints: ["↑↓ move", "␣ toggle", "⏎ install", "esc cancel"],
				previewTitle: "Description",
				preview: (_values, _elapsedMs, activeItemId) => ({ lines: renderDescription(missing, activeItemId) }),
			});
			if (!result.applied) {
				ctx.ui.notify("Pi Topping setup cancelled.", "info");
				return;
			}

			const selected = selectedToppings(missing, result.values);
			if (selected.length === 0) {
				ctx.ui.notify("No Pi Topping extensions selected.", "info");
				return;
			}

			const { succeeded, failed } = await installSelected(ctx, selected, install);
			ctx.ui.notify(buildReport(succeeded, failed), failed.length > 0 ? "warning" : "info");
		},
	});
}
