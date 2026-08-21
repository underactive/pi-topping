/**
 * A reusable, dependency-light box-drawing toggle-menu component for Pi
 * extensions, built on top of `@earendil-works/pi-tui`'s `Component`
 * contract and `ctx.ui.custom()` overlay API.
 *
 * Renders a titled box containing one or more sections of boolean toggle,
 * multi-value cycle, or drag-to-reorder items, plus an optional live-updating
 * preview section driven by a caller-supplied render callback, e.g.:
 *
 *   ╔═[ Pi Topping: Settings ]════════════════════════╗
 *   ╟─ Preview ────────────────────────────────────╢
 *   ║                                                  ║
 *   ║ ⠋ Cerebrating… ⣤⣤⣤⣤  28 tok/s · 3s · ↓ 84 tokens ║
 *   ║                                                  ║
 *   ╟─ Decorations ───────────────────────────────────╢
 *   ║  ❯ [■] Animated spinner                    ON   ║
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

export type MenuValue = boolean | string;

/** Lines to display and an optional delay before the preview should refresh. */
export interface PreviewResult {
	lines: string[];
	nextRefreshInMs?: number;
}

export interface MenuItem {
	id: string;
	label: string;
	value: MenuValue;
	/** Values cycled with left/right arrows. Omit for a boolean space-toggle. */
	cycleValues?: readonly string[];
	/** ID of the boolean value that gates cycling; space toggles it. */
	cycleEnabledBy?: string;
	/** Initial enabled state when `cycleEnabledBy` is set (default true). */
	cycleEnabled?: boolean;
	/** Value snapped to when the gating checkbox is unchecked. */
	cycleDisabledValue?: string;
	/**
	 * Marks the item as a reorderable row. Space grabs/releases it; while grabbed,
	 * up/down move it among the other rows sharing this group instead of moving the
	 * cursor. The group's current order is published as a comma-joined list of item
	 * ids under this key in the result values.
	 */
	reorderGroup?: string;
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
	 * Optional preview renderer, shown in its own "Preview" section above the
	 * toggle sections. Called on every render with the menu's current (possibly
	 * toggled but not-yet-applied) values and the number of milliseconds elapsed
	 * since the menu opened. Lines may contain ANSI styling and are truncated/
	 * padded to fit automatically.
	 *
	 * Return `string[]` for legacy interval-based animation (see
	 * `previewIntervalMs`), or a `PreviewResult` to declare the next refresh.
	 * Omitting `nextRefreshInMs` from a `PreviewResult` makes the preview static.
	 */
	preview?: (values: Record<string, MenuValue>, elapsedMs: number, activeItemId: string | undefined, width: number) => string[] | PreviewResult;
	/** Optional heading for the preview block. Defaults to `Preview`. */
	previewTitle?: string;
	/** Fallback delay in ms for legacy `string[]` previews. Default 50. */
	previewIntervalMs?: number;
}

export interface MenuResult<T> {
	applied: boolean;
	values: T;
}

const DEFAULT_HINTS = ["\u2191\u2193 move", "\u2423 toggle", "\u23ce apply", "esc cancel"];
const OVERLAY_WIDTH = "86%";
const DEFAULT_PREVIEW_WIDTH = 76;
const ROW_PREFIX_WIDTH = 8; // "  " + marker + " " + "[" + box + "]" + " "

/** Close OSC 8 links truncated by pi-tui's SGR-only truncation reset. */
function closeTruncatedHyperlink(text: string): string {
	const lastOpen = text.lastIndexOf("\x1b]8;;");
	const lastClose = text.lastIndexOf("\x1b]8;;\x1b\\");
	return lastOpen > lastClose ? `${text}\x1b]8;;\x1b\\` : text;
}

interface FlatItem {
	id: string;
	label: string;
	cycleValues?: readonly string[];
	cycleEnabledBy?: string;
	cycleDisabledValue?: string;
	reorderGroup?: string;
	item: MenuItem;
	sectionIndex: number;
}

function buildInitialValues(config: MenuConfig): Record<string, MenuValue> {
	const values: Record<string, MenuValue> = {};
	const reorderGroups = new Map<string, string[]>();
	for (const section of config.sections) {
		for (const item of section.items) {
			values[item.id] = item.value;
			if (item.cycleEnabledBy) values[item.cycleEnabledBy] = item.cycleEnabled ?? true;
			if (item.reorderGroup) {
				const ids = reorderGroups.get(item.reorderGroup) ?? [];
				ids.push(item.id);
				reorderGroups.set(item.reorderGroup, ids);
			}
		}
	}
	for (const [group, ids] of reorderGroups) values[group] = ids.join(",");
	return values;
}

/** Internal Component implementing the box-drawing toggle menu. */
export class MenuComponent implements Component {
	private readonly theme: Theme;
	private readonly done: (result: MenuResult<Record<string, MenuValue>>) => void;
	private readonly title: string;
	private readonly sections: MenuSection[];
	private readonly hints: string[];
	private readonly previewTitle: string;
	private readonly initialValues: Record<string, MenuValue>;
	private readonly values: Record<string, MenuValue>;
	private readonly flat: FlatItem[];
	private readonly previewFn: MenuConfig["preview"];
	private readonly previewIntervalMs: number | undefined;
	private readonly previewOrigin: number | undefined;
	private readonly tui: TUI | undefined;
	private previewTimer: ReturnType<typeof setTimeout> | undefined;
	private previewNextRefreshMs: number | undefined;
	private disposed = false;
	private cursor = 0;
	private scrollStart = 0;
	private cachedWidth: number | undefined;
	private cachedRows: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(
		config: MenuConfig,
		theme: Theme,
		done: (result: MenuResult<Record<string, MenuValue>>) => void,
		tui?: TUI,
	) {
		this.theme = theme;
		this.done = done;
		this.title = config.title;
		this.sections = config.sections;
		this.hints = config.hints ?? DEFAULT_HINTS;
		this.previewTitle = config.previewTitle ?? "Preview";
		this.tui = tui;
		this.values = buildInitialValues(config);
		this.flat = [];
		for (const [sectionIndex, section] of config.sections.entries()) {
			for (const item of section.items) {
				this.flat.push({ id: item.id, label: item.label, cycleValues: item.cycleValues, cycleEnabledBy: item.cycleEnabledBy, cycleDisabledValue: item.cycleDisabledValue, reorderGroup: item.reorderGroup, item, sectionIndex });
			}
		}
		this.initialValues = { ...this.values };

		this.previewFn = config.preview;
		this.previewIntervalMs = config.previewIntervalMs;
		if (this.previewFn) {
			this.previewOrigin = Date.now();
			if (tui) {
				this.samplePreview();
				this.schedulePreview();
			}
		}
	}

	/** Stops the preview animation timer, if any. Called automatically when the overlay closes. */
	dispose(): void {
		this.disposed = true;
		if (this.previewTimer !== undefined) {
			clearTimeout(this.previewTimer);
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
		for (const k of [Key.up, Key.down, Key.left, Key.right, Key.space, Key.enter, Key.escape]) {
			if (matchesKey(data, k)) {
				mappedKey = k;
				break;
			}
		}
		if (!mappedKey && matchesKey(data, Key.ctrl("c"))) mappedKey = Key.escape;

		const keyActions: Record<string, () => void> = {
			[Key.up]: () => {
				if (this.moveGrabbedItem(-1)) return;
				this.cursor = (this.cursor - 1 + this.flat.length) % this.flat.length;
				this.invalidate();
			},
			[Key.down]: () => {
				if (this.moveGrabbedItem(1)) return;
				this.cursor = (this.cursor + 1) % this.flat.length;
				this.invalidate();
			},
			[Key.left]: () => this.cycleCurrentValue(-1),
			[Key.right]: () => this.cycleCurrentValue(1),
			[Key.space]: () => {
				const item = this.flat[this.cursor]!;
				if (item.cycleValues && item.cycleEnabledBy) {
					this.values[item.cycleEnabledBy] = !this.values[item.cycleEnabledBy] as boolean;
					if (!this.values[item.cycleEnabledBy] && item.cycleDisabledValue !== undefined) this.values[item.id] = item.cycleDisabledValue;
				} else if (!item.cycleValues) this.values[item.id] = !this.values[item.id] as boolean;
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
		this.cachedRows = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		const rows = this.availableRows();
		if (this.cachedWidth === width && this.cachedRows === rows && this.cachedLines) return this.cachedLines;
		const lines = this.buildLines(width, rows);
		this.cachedWidth = width;
		this.cachedRows = rows;
		this.cachedLines = lines;
		this.schedulePreview();
		return lines;
	}

	/**
	 * Move the grabbed reorder row one slot within its group, clamped at the group
	 * edges. Returns true when the key belongs to the mover and must not also move
	 * the cursor — which is what keeps a grab from escaping its group.
	 */
	private moveGrabbedItem(delta: number): boolean {
		const grabbed = this.flat[this.cursor]!;
		const group = grabbed.reorderGroup;
		if (group === undefined || this.values[grabbed.id] !== true) return false;

		let start = this.cursor;
		while (start > 0 && this.flat[start - 1]!.reorderGroup === group) start--;
		let end = this.cursor;
		while (end < this.flat.length - 1 && this.flat[end + 1]!.reorderGroup === group) end++;

		const target = this.cursor + delta;
		if (target >= start && target <= end) {
			this.flat[this.cursor] = this.flat[target]!;
			this.flat[target] = grabbed;
			this.cursor = target;
			this.values[group] = this.flat.slice(start, end + 1).map(flat => flat.id).join(",");
			this.invalidate();
		}
		return true;
	}

	private cycleCurrentValue(delta: number): void {
		const item = this.flat[this.cursor]!;
		if (!item.cycleValues?.length || (item.cycleEnabledBy && !this.values[item.cycleEnabledBy])) return;
		const current = item.cycleValues.indexOf(this.values[item.id] as string);
		const index = (current + delta + item.cycleValues.length) % item.cycleValues.length;
		this.values[item.id] = item.cycleValues[index]!;
		this.invalidate();
	}

	private samplePreview(width: number = DEFAULT_PREVIEW_WIDTH): string[] | undefined {
		if (!this.previewFn) return undefined;

		const result = this.previewFn(
			this.values,
			this.previewOrigin !== undefined ? Date.now() - this.previewOrigin : 0,
			this.flat[this.cursor]?.id,
			width,
		);
		if (Array.isArray(result)) {
			this.previewNextRefreshMs = this.previewIntervalMs ?? 50;
			return result;
		}

		this.previewNextRefreshMs = result.nextRefreshInMs;
		return result.lines;
	}

	private schedulePreview(): void {
		if (this.previewTimer !== undefined) {
			clearTimeout(this.previewTimer);
			this.previewTimer = undefined;
		}

		const nextRefreshInMs = this.previewNextRefreshMs;
		if (this.disposed || !this.tui || nextRefreshInMs === undefined || nextRefreshInMs <= 0) return;

		this.previewTimer = setTimeout(() => {
			this.invalidate();
			this.tui?.requestRender();
		}, nextRefreshInMs);
	}

	private buildPreviewBlock(previewLines: string[] | undefined, innerWidth: number): string[] {
		if (!previewLines?.length) return [];
		return [this.renderSectionDivider(this.previewTitle, innerWidth), this.renderBlankRow(innerWidth), ...previewLines.map(line => this.renderContentRow(` ${line}`, innerWidth)), this.renderBlankRow(innerWidth)];
	}

	/** Render every section from `this.flat`, the single source of truth for row order. */
	private buildToggleSections(innerWidth: number): string[] {
		const lines: string[] = [];
		let currentSection = -1;
		for (const [index, flat] of this.flat.entries()) {
			if (flat.sectionIndex !== currentSection) {
				if (currentSection !== -1) lines.push(this.renderBlankRow(innerWidth));
				lines.push(this.renderSectionDivider(this.sections[flat.sectionIndex]!.title, innerWidth));
				currentSection = flat.sectionIndex;
			}
			lines.push(this.renderItemRow(flat.item, index === this.cursor, innerWidth));
		}
		if (lines.length) lines.push(this.renderBlankRow(innerWidth));
		return lines;
	}

	/** Build a section-aware item window, keeping a divider above each visible section. */
	private buildToggleWindow(innerWidth: number, start: number, maxRows: number): { lines: string[]; end: number } {
		const lines: string[] = [];
		let currentSection = -1;
		let end = start - 1;
		for (let index = start; index < this.flat.length && lines.length < maxRows; index++) {
			const flat = this.flat[index]!;
			if (flat.sectionIndex !== currentSection) {
				const remaining = maxRows - lines.length;
				if (lines.length > 0 && remaining >= 3) lines.push(this.renderBlankRow(innerWidth));
				if (maxRows - lines.length >= 2) lines.push(this.renderSectionDivider(this.sections[flat.sectionIndex]!.title, innerWidth));
				currentSection = flat.sectionIndex;
			}
			if (lines.length >= maxRows) break;
			lines.push(this.renderItemRow(flat.item, index === this.cursor, innerWidth));
			end = index;
		}
		if (end === this.flat.length - 1 && lines.length < maxRows) lines.push(this.renderBlankRow(innerWidth));
		return { lines, end };
	}

	/** Render the scrolling settings body while keeping the selected item in view. */
	private buildResponsiveToggleSections(innerWidth: number, maxRows: number, allLines: string[]): string[] {
		if (allLines.length <= maxRows) {
			this.scrollStart = 0;
			return allLines;
		}
		if (maxRows <= 0) return [];
		if (maxRows === 1) return this.buildToggleWindow(innerWidth, this.cursor, 1).lines;

		const contentRows = maxRows - 1; // Reserve one fixed row for scroll status.
		if (this.cursor < this.scrollStart) this.scrollStart = this.cursor;
		this.scrollStart = Math.max(0, Math.min(this.scrollStart, this.flat.length - 1));

		let window = this.buildToggleWindow(innerWidth, this.scrollStart, contentRows);
		while (window.end < this.cursor && this.scrollStart < this.cursor) {
			this.scrollStart++;
			window = this.buildToggleWindow(innerWidth, this.scrollStart, contentRows);
		}
		// Backfill from above whenever more context fits without hiding the cursor.
		while (this.scrollStart > 0) {
			const candidate = this.buildToggleWindow(innerWidth, this.scrollStart - 1, contentRows);
			if (candidate.end < this.cursor) break;
			this.scrollStart--;
			window = candidate;
		}

		const rows = [...window.lines];
		while (rows.length < contentRows) rows.push(this.renderBlankRow(innerWidth));
		rows.push(this.renderScrollStatus(this.scrollStart > 0, window.end < this.flat.length - 1, innerWidth));
		return rows;
	}

	private buildFooter(innerWidth: number): string[] {
		return [this.renderSeparator(innerWidth), this.renderHintsRow(innerWidth), this.renderBottomBorder(innerWidth)];
	}

	private availableRows(): number | undefined {
		const rows = (this.tui as (TUI & { terminal?: { rows?: number } }) | undefined)?.terminal?.rows;
		return typeof rows === "number" && Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : undefined;
	}

	private buildLines(maxWidth: number, maxRows?: number): string[] {
		const boxWidth = Math.max(0, maxWidth);
		const innerWidth = Math.max(0, boxWidth - 2);
		// Preview rows are prefixed with a leading space by buildPreviewBlock/renderContentRow.
		const previewLines = this.samplePreview(Math.max(0, innerWidth - 1));
		const header = [this.renderTopBorder(innerWidth), ...this.buildPreviewBlock(previewLines, innerWidth)];
		const footer = this.buildFooter(innerWidth);
		const naturalBody = this.buildToggleSections(innerWidth);
		const naturalHeight = header.length + naturalBody.length + footer.length;
		if (maxRows === undefined || naturalHeight <= maxRows) {
			return [...header, ...naturalBody, ...footer].map(line => truncateToWidth(line, boxWidth, ""));
		}

		const bodyRows = Math.max(0, maxRows - header.length - footer.length);
		const body = this.buildResponsiveToggleSections(innerWidth, bodyRows, naturalBody);
		return [...header, ...body, ...footer].slice(0, maxRows).map(line => truncateToWidth(line, boxWidth, ""));
	}

	private wrap(left: string, content: string, right: string): string {
		const th = this.theme;
		return th.fg("border", left) + content + th.fg("border", right);
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
			const content = th.fg("border", fillChar.repeat(innerWidth));
			return this.wrap(left, content, right);
		}
		const prefix = titlePrefix ?? "";
		const suffix = titleSuffix ?? "";
		const maxTitleLen = Math.max(0, innerWidth - prefix.length - suffix.length);
		const shownTitle = visibleWidth(title) > maxTitleLen ? truncateToWidth(title, maxTitleLen) : title;
		const styledTitle = boldTitle ? th.bold(shownTitle) : shownTitle;
		const fillCount = Math.max(0, innerWidth - visibleWidth(prefix + shownTitle + suffix));
		const titleContent = th.fg("text", styledTitle);
		const content = `${th.fg("border", prefix)}${titleContent}${th.fg("border", suffix + fillChar.repeat(fillCount))}`;
		return this.wrap(left, content, right);
	}

	private renderTopBorder(innerWidth: number): string {
		return this.renderFilledLine("\u2554", "\u2557", "\u2550", innerWidth, this.title, "\u2550[ ", " ]", true);
	}

	private renderBottomBorder(innerWidth: number): string {
		const counter = `[ ${this.cursor + 1}/${this.flat.length} ]`;
		const fillCount = Math.max(0, innerWidth - counter.length);
		const content = `${"\u2550".repeat(fillCount)}${counter}`;
		return this.wrap("\u255a", this.theme.fg("border", content), "\u255d");
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
		const truncated = visibleWidth(content) > innerWidth;
		const shown = truncated ? closeTruncatedHyperlink(truncateToWidth(content, innerWidth)) : content;
		const pad = Math.max(0, innerWidth - visibleWidth(shown));
		return this.wrap("\u2551", `${shown}${" ".repeat(pad)}`, "\u2551");
	}

	private renderHintsRow(innerWidth: number): string {
		const plain = `  ${this.hints.join("  ")}`;
		return this.renderContentRow(this.theme.fg("dim", plain), innerWidth);
	}

	private renderScrollStatus(hasAbove: boolean, hasBelow: boolean, innerWidth: number): string {
		const parts = [hasAbove ? "↑ more above" : "", hasBelow ? "↓ more below" : ""].filter(Boolean);
		return this.renderContentRow(this.theme.fg("dim", `  ${parts.join("    ")}`), innerWidth);
	}

	private renderItemRow(item: MenuItem, selected: boolean, innerWidth: number): string {
		const th = this.theme;
		const value = this.values[item.id]!;
		const marker = selected ? "\u276f" : " ";
		const markerColored = selected ? th.fg("accent", marker) : marker;

		if (item.reorderGroup) {
			const held = value as boolean;
			const stateWord = held ? "\u2191 \u2193" : "";
			const rightPlain = `${stateWord}  `;
			const maxLabelLen = Math.max(0, innerWidth - ROW_PREFIX_WIDTH - visibleWidth(rightPlain) - 1);
			const label = visibleWidth(item.label) > maxLabelLen ? truncateToWidth(item.label, maxLabelLen) : item.label;
			const leftPlain = `  ${marker} [${held ? "\u25a0" : " "}] ${label}`;
			const gap = Math.max(1, innerWidth - visibleWidth(leftPlain) - visibleWidth(rightPlain));
			const content = `  ${markerColored} [${held ? th.fg("accent", "\u25a0") : th.fg("muted", " ")}] ${th.fg("text", label)}${" ".repeat(gap)}${held ? th.fg("accent", stateWord) : ""}  `;
			return this.wrap("\u2551", selected ? th.bg("selectedBg", content) : content, "\u2551");
		}

		if (item.cycleValues) {
			const enabled = item.cycleEnabledBy ? this.values[item.cycleEnabledBy] as boolean : true;
			const stateWord = `‹ ${value} ›`;
			const maxLabelLen = Math.max(0, innerWidth - ROW_PREFIX_WIDTH - visibleWidth(stateWord) - 1);
			const label = visibleWidth(item.label) > maxLabelLen ? truncateToWidth(item.label, maxLabelLen) : item.label;
			const leftPlain = `  ${marker} [${enabled ? "■" : " "}] ${label}`;
			const gap = Math.max(1, innerWidth - visibleWidth(leftPlain) - visibleWidth(stateWord) - 2);
			const content = `  ${markerColored} [${enabled ? th.fg("success", "■") : th.fg("muted", " ")}] ${th.fg("text", label)}${" ".repeat(gap)}${enabled ? th.fg("accent", stateWord) : th.fg("muted", stateWord)}  `;
			return this.wrap("\u2551", selected ? th.bg("selectedBg", content) : content, "\u2551");
		}

		const enabled = value as boolean;
		const box = enabled ? "\u25a0" : " ";
		const stateWord = enabled ? "ON" : "OFF";
		const rightPlain = `${stateWord}  `;
		const maxLabelLen = Math.max(0, innerWidth - ROW_PREFIX_WIDTH - visibleWidth(rightPlain) - 1);
		const label = visibleWidth(item.label) > maxLabelLen ? truncateToWidth(item.label, maxLabelLen) : item.label;
		const leftPlain = `  ${marker} [${box}] ${label}`;
		const gap = Math.max(1, innerWidth - visibleWidth(leftPlain) - visibleWidth(rightPlain));
		const content = `  ${markerColored} [${enabled ? th.fg("success", box) : th.fg("muted", box)}] ${th.fg("text", label)}${" ".repeat(gap)}${enabled ? th.fg("success", stateWord) : th.fg("muted", stateWord)}  `;
		return this.wrap("\u2551", selected ? th.bg("selectedBg", content) : content, "\u2551");
	}
}

/**
 * Show a modal box-drawing toggle menu and resolve once the user applies
 * (Enter) or cancels (Escape / Ctrl+C) it.
 *
 * Requires TUI mode; in any other mode this resolves immediately with
 * `applied: false` and the menu's initial values, doing nothing visible.
 */
export async function showMenu<T extends Record<string, MenuValue>>(
	ctx: ExtensionCommandContext,
	config: MenuConfig,
): Promise<MenuResult<T>> {
	const initialValues = buildInitialValues(config) as T;

	if (ctx.mode !== "tui") {
		return { applied: false, values: initialValues };
	}

	return ctx.ui.custom<MenuResult<T>>(
		(tui, theme, _keybindings, done) =>
			new MenuComponent(config, theme, done as (result: MenuResult<Record<string, MenuValue>>) => void, tui),
		{ overlay: true, overlayOptions: { width: OVERLAY_WIDTH, maxHeight: "100%" } },
	);
}
