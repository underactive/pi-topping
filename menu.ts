/**
 * menu.ts
 *
 * A reusable, dependency-light box-drawing toggle-menu component for Pi
 * extensions, built on top of `@earendil-works/pi-tui`'s `Component`
 * contract and `ctx.ui.custom()` overlay API.
 *
 * Renders a titled box containing one or more sections of boolean toggle
 * items, plus an optional live-updating preview section driven by a
 * caller-supplied render callback, e.g.:
 *
 *   ╔═[ Pi Topping: Settings ]════════════════════════╗
 *   ╟─ Preview ─────────────────────────────────────╢
 *   ║                                                  ║
 *   ║ ⠋ Cerebrating… ⣤⣤⣤⣤ (0m 03s · ↓ 84 tokens)     ║
 *   ║                                                  ║
 *   ╟─ Decorations ───────────────────────────────────╢
 *   ║  ▸ [■] Animated spinner                    ON   ║
 *   ║    [ ] "Working..." text shimmer           OFF   ║
 *   ║                                                  ║
 *   ╟──────────────────────────────────────────────────╢
 *   ║  ↑↓ move  ␣ toggle  ⏎ apply  esc cancel          ║
 *   ╚══════════════════════════════════════════[ 1/2 ]═╝
 *
 * Intended to be reused by any extension that needs a simple modal toggle
 * menu; it has no dependency on this extension's own settings shape.
 */

import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";

export interface MenuItem {
	id: string;
	label: string;
	value: boolean;
}

export interface MenuSection {
	title: string;
	items: MenuItem[];
}

export interface MenuConfig {
	title: string;
	sections: MenuSection[];
	hints?: string[];
	/**
	 * Optional live preview renderer, shown in its own "Preview" section above
	 * the toggle sections. Called on every render with the menu's current
	 * (possibly toggled but not-yet-applied) values and the number of
	 * milliseconds elapsed since the menu opened, so callers can drive
	 * animation (e.g. a shimmer sweep or a scrolling meter). Return one string
	 * per preview line; lines may contain ANSI styling and are truncated/
	 * padded to fit automatically.
	 *
	 * When set, the menu re-renders itself on an interval (see
	 * `previewIntervalMs`) so the preview animates even without keyboard
	 * input.
	 */
	preview?: (values: Record<string, boolean>, elapsedMs: number) => string[];
	/** Interval in ms between preview re-renders when `preview` is set. Default 50. */
	previewIntervalMs?: number;
}

export interface MenuResult<T> {
	applied: boolean;
	values: T;
}

const DEFAULT_HINTS = ["\u2191\u2193 move", "\u2423 toggle", "\u23ce apply", "esc cancel"];
const MIN_WIDTH = 36;
const MAX_WIDTH = 76;

interface FlatItem {
	id: string;
	label: string;
}

/** Internal Component implementing the box-drawing toggle menu. */
export class MenuComponent implements Component {
	private readonly theme: Theme;
	private readonly done: (result: MenuResult<Record<string, boolean>>) => void;
	private readonly title: string;
	private readonly sections: MenuSection[];
	private readonly hints: string[];
	private readonly initialValues: Record<string, boolean>;
	private readonly values: Record<string, boolean>;
	private readonly flat: FlatItem[];
	private readonly previewFn: MenuConfig["preview"];
	private readonly previewOrigin: number | undefined;
	private previewTimer: ReturnType<typeof setInterval> | undefined;
	private cursor = 0;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(
		config: MenuConfig,
		theme: Theme,
		done: (result: MenuResult<Record<string, boolean>>) => void,
		tui?: TUI,
	) {
		this.theme = theme;
		this.done = done;
		this.title = config.title;
		this.sections = config.sections;
		this.hints = config.hints ?? DEFAULT_HINTS;
		this.values = {};
		this.flat = [];
		for (const section of config.sections) {
			for (const item of section.items) {
				this.values[item.id] = item.value;
				this.flat.push({ id: item.id, label: item.label });
			}
		}
		this.initialValues = { ...this.values };

		this.previewFn = config.preview;
		if (this.previewFn) {
			this.previewOrigin = Date.now();
			if (tui) {
				const intervalMs = config.previewIntervalMs ?? 50;
				this.previewTimer = setInterval(() => {
					this.invalidate();
					tui.requestRender();
				}, intervalMs);
			}
		}
	}

	/** Stops the preview animation timer, if any. Called automatically when the overlay closes. */
	dispose(): void {
		if (this.previewTimer) {
			clearInterval(this.previewTimer);
			this.previewTimer = undefined;
		}
	}

	handleInput(data: string): void {
		if (this.flat.length === 0) {
			if (matchesKey(data, Key.enter)) {
				this.done({ applied: true, values: { ...this.values } });
			} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
				this.done({ applied: false, values: { ...this.initialValues } });
			}
			return;
		}

		// Map input to a normalized key name.
		let mappedKey: string | undefined;
		for (const k of [Key.up, Key.down, Key.space, Key.enter, Key.escape]) {
			if (matchesKey(data, k)) {
				mappedKey = k;
				break;
			}
		}
		if (!mappedKey && matchesKey(data, Key.ctrl("c"))) mappedKey = Key.escape;

		const keyActions: Record<string, () => void> = {
			[Key.up]: () => {
				this.cursor = (this.cursor - 1 + this.flat.length) % this.flat.length;
				this.invalidate();
			},
			[Key.down]: () => {
				this.cursor = (this.cursor + 1) % this.flat.length;
				this.invalidate();
			},
			[Key.space]: () => {
				const item = this.flat[this.cursor]!;
				this.values[item.id] = !this.values[item.id];
				this.invalidate();
			},
			[Key.enter]: () => this.done({ applied: true, values: { ...this.values } }),
			[Key.escape]: () => this.done({ applied: false, values: { ...this.initialValues } }),
		};

		const handler = mappedKey ? keyActions[mappedKey] : undefined;
		if (handler) handler();
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;
		const lines = this.buildLines(width);
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	private preferredWidth(previewLines: string[] | undefined): number {
		const candidates: number[] = [MIN_WIDTH - 2, 5 + this.title.length];
		if (previewLines && previewLines.length > 0) {
			candidates.push(3 + "Preview".length);
			// +1 for the leading space rendered in front of each preview line.
			for (const line of previewLines) candidates.push(visibleWidth(line) + 1);
		}
		for (const section of this.sections) {
			candidates.push(3 + section.title.length);
			for (const item of section.items) {
				// 8 fixed left columns + label + 2-space default gap + "OFF" (3) + 2 trailing.
				candidates.push(8 + item.label.length + 2 + 3 + 2);
			}
		}
		candidates.push(2 + this.hints.join("  ").length);
		return 2 + Math.max(...candidates);
	}

	private samplePreview(): string[] | undefined {
		return this.previewFn ? this.previewFn(this.values, this.previewOrigin !== undefined ? Date.now() - this.previewOrigin : 0) : undefined;
	}

	private buildPreviewBlock(previewLines: string[] | undefined, innerWidth: number): string[] {
		if (!previewLines?.length) return [];
		return [this.renderSectionDivider("Preview", innerWidth), this.renderBlankRow(innerWidth), ...previewLines.map(line => this.renderContentRow(` ${line}`, innerWidth)), this.renderBlankRow(innerWidth)];
	}

	private buildToggleSections(innerWidth: number): string[] {
		let flatIndex = 0;
		return this.sections.flatMap(section => [
			this.renderSectionDivider(section.title, innerWidth),
			...section.items.map(item => this.renderItemRow(item, flatIndex++ === this.cursor, innerWidth)),
			this.renderBlankRow(innerWidth),
		]);
	}

	private buildFooter(innerWidth: number): string[] {
		return [this.renderSeparator(innerWidth), this.renderHintsRow(innerWidth), this.renderBottomBorder(innerWidth)];
	}

	private buildLines(maxWidth: number): string[] {
		const previewLines = this.samplePreview();
		const boxWidth = Math.max(0, Math.min(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, this.preferredWidth(previewLines))), maxWidth));
		const innerWidth = Math.max(0, boxWidth - 2);
		return [this.renderTopBorder(innerWidth), ...this.buildPreviewBlock(previewLines, innerWidth), ...this.buildToggleSections(innerWidth), ...this.buildFooter(innerWidth)].map(line => truncateToWidth(line, boxWidth, ""));
	}

	private wrap(left: string, content: string, right: string): string {
		const th = this.theme;
		return th.fg("accent", left) + content + th.fg("accent", right);
	}

	/** Render a filled horizontal line with optional title. */
	private renderFilledLine(
		left: string,
		right: string,
		fillChar: string,
		innerWidth: number,
		title?: string,
		titlePrefix?: string,
		titleSuffix?: string,
		boldTitle?: boolean,
	): string {
		const th = this.theme;
		if (!title) {
			const content = th.fg("accent", fillChar.repeat(innerWidth));
			return this.wrap(left, content, right);
		}
		const prefix = titlePrefix ?? "";
		const suffix = titleSuffix ?? "";
		const maxTitleLen = Math.max(0, innerWidth - prefix.length - suffix.length);
		const shownTitle = title.length > maxTitleLen ? truncateToWidth(title, maxTitleLen) : title;
		const styledTitle = boldTitle ? th.bold(shownTitle) : shownTitle;
		const fillCount = Math.max(0, innerWidth - visibleWidth(prefix + shownTitle + suffix));
		const content = th.fg("accent", `${prefix}${styledTitle}${suffix}${fillChar.repeat(fillCount)}`);
		return this.wrap(left, content, right);
	}

	private renderTopBorder(innerWidth: number): string {
		return this.renderFilledLine("\u2554", "\u2557", "\u2550", innerWidth, this.title, "\u2550[ ", " ]", true);
	}

	private renderBottomBorder(innerWidth: number): string {
		const counter = `[ ${this.cursor + 1}/${this.flat.length} ]`;
		const fillCount = Math.max(0, innerWidth - counter.length);
		const content = `${"\u2550".repeat(fillCount)}${counter}`;
		return this.wrap("\u255a", this.theme.fg("accent", content), "\u255d");
	}

	private renderSectionDivider(title: string, innerWidth: number): string {
		return this.renderFilledLine("\u255f", "\u2562", "\u2500", innerWidth, title, "\u2500 ", " \u2500");
	}

	private renderSeparator(innerWidth: number): string {
		return this.renderFilledLine("\u255f", "\u2562", "\u2500", innerWidth);
	}

	private renderBlankRow(innerWidth: number): string {
		return this.wrap("\u2551", " ".repeat(innerWidth), "\u2551");
	}

	/** Pads/truncates an already-styled content string to exactly `innerWidth` and wraps it in border chars. */
	private renderContentRow(content: string, innerWidth: number): string {
		const shown = visibleWidth(content) > innerWidth ? truncateToWidth(content, innerWidth) : content;
		const pad = Math.max(0, innerWidth - visibleWidth(shown));
		return this.wrap("\u2551", `${shown}${" ".repeat(pad)}`, "\u2551");
	}

	private renderHintsRow(innerWidth: number): string {
		const plain = `  ${this.hints.join("  ")}`;
		return this.renderContentRow(this.theme.fg("dim", plain), innerWidth);
	}

	private renderItemRow(item: MenuItem, selected: boolean, innerWidth: number): string {
		const th = this.theme;
		const value = this.values[item.id]!;
		const marker = selected ? "\u25b8" : " ";
		const box = value ? "\u25a0" : " ";
		const stateWord = value ? "ON" : "OFF";
		const rightPlain = `${stateWord}  `;
		const fixedLeftLen = 8; // "  " + marker(1) + " " + "[" + box(1) + "]" + " "
		const minGap = 1;
		const maxLabelLen = Math.max(0, innerWidth - fixedLeftLen - rightPlain.length - minGap);
		const label = item.label.length > maxLabelLen ? truncateToWidth(item.label, maxLabelLen) : item.label;

		const leftPlain = `  ${marker} [${box}] ${label}`;
		const gap = Math.max(1, innerWidth - visibleWidth(leftPlain) - visibleWidth(rightPlain));

		const markerColored = selected ? th.fg("accent", marker) : marker;
		const boxColored = value ? th.fg("success", box) : th.fg("muted", box);
		const labelColored = th.fg("text", label);
		const stateColored = value ? th.fg("success", stateWord) : th.fg("muted", stateWord);

		const content = `  ${markerColored} [${boxColored}] ${labelColored}${" ".repeat(gap)}${stateColored}  `;
		return this.wrap("\u2551", content, "\u2551");
	}
}

/**
 * Show a modal box-drawing toggle menu and resolve once the user applies
 * (Enter) or cancels (Escape / Ctrl+C) it.
 *
 * Requires TUI mode; in any other mode this resolves immediately with
 * `applied: false` and the menu's initial values, doing nothing visible.
 */
export async function showMenu<T extends Record<string, boolean>>(
	ctx: ExtensionCommandContext,
	config: MenuConfig,
): Promise<MenuResult<T>> {
	const initialValues = Object.fromEntries(
		config.sections.flatMap((section) => section.items.map((item) => [item.id, item.value])),
	) as T;

	if (ctx.mode !== "tui") {
		return { applied: false, values: initialValues };
	}

	return ctx.ui.custom<MenuResult<T>>(
		(tui, theme, _keybindings, done) =>
			new MenuComponent(config, theme, done as (result: MenuResult<Record<string, boolean>>) => void, tui),
		{ overlay: true },
	);
}
