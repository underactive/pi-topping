import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { getThinkingLevelColorizer, isThinkingLevel, type ThinkingLevel } from "./format.ts";
import { DEFAULT_SETTINGS, isBorderStyle, isPromptBorderColor, type BorderStyle, type DoneMarkerBorderColor, type DoneMarkerBorderStyle, type DoneMarkerStyle, type PromptBorderColor } from "./settings.ts";
import { stripControlChars } from "./util.ts";

export const PROMPT_BOX_TYPE = "pi-topping-prompt";

const BORDER_GLYPHS: Record<BorderStyle, { tl: string; tr: string; bl: string; br: string; h: string; v: string }> = {
	double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
	single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
	rounded: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
	heavy: { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" },
};

/**
 * False visibility options hide each corresponding part; present provider and
 * model values join with `/` in the bottom border.
 */
export interface PromptBoxDetails {
	submittedAt?: number;
	showIcon?: boolean;
	showTimestamp?: boolean;
	showProvider?: boolean;
	showModel?: boolean;
	icon?: string;
	provider?: string;
	model?: string;
	borderColor?: PromptBorderColor;
	borderStyle?: BorderStyle;
	thinkingLevel?: ThinkingLevel;
}

type PromptTheme = {
	fg(color: string, text: string): string;
	getThinkingBorderColor(level: ThinkingLevel): (text: string) => string;
};

const COMPLETION_MARKER_TRAIL_RUNS = [6, 4, 2, 1] as const;

/** Assemble the completion-marker content: an optional icon, then the dim `word for elapsed (details)` summary. */
export function buildCompletionMarkerContent(
	theme: PromptTheme,
	icon: string,
	word: string,
	elapsed: string,
	details: string[],
): string {
	const tail = details.length ? ` (${details.join(" · ")})` : "";
	return `${icon}${theme.fg("dim", `${icon ? " " : ""}${word} for ${elapsed}${tail}`)}`;
}

/** Build one decorated completion-marker line, clipped to the available width. */
export function buildCompletionMarkerLine(
	content: string,
	width: number,
	theme: PromptTheme,
	borderStyle: DoneMarkerBorderStyle,
	borderColor: DoneMarkerBorderColor,
	markerStyle: DoneMarkerStyle = DEFAULT_SETTINGS.decorations.doneMarkerStyle,
	thinkingLevel?: ThinkingLevel,
): string {
	const safeWidth = Math.max(0, Math.floor(width));
	if (safeWidth === 0) return "";
	if (borderStyle === "none") return truncateToWidth(content, safeWidth);

	const g = BORDER_GLYPHS[borderStyle];
	const border = getThinkingLevelColorizer(theme, borderColor, thinkingLevel);
	const prefix = `${g.bl}${g.h.repeat(2)} `;

	const suffix = markerStyle === "bookend"
		? ` ${g.h.repeat(Math.max(0, safeWidth - visibleWidth(prefix) - visibleWidth(content) - 2))}${g.br}`
		: ` ${COMPLETION_MARKER_TRAIL_RUNS.map(length => g.h.repeat(length)).join(" ")}`;
	const line = `${border(prefix)}${content}${border(suffix)}`;
	return visibleWidth(line) > safeWidth ? truncateToWidth(line, safeWidth) : line;
}

/** Build the rendered lines for a decorated user prompt. */
export function buildPromptBoxLines(
	content: string,
	submittedAt: number | undefined,
	width: number,
	theme: PromptTheme,
	options: PromptBoxDetails = {},
): string[] {
	if (width < 10) return [];

	const borderStyle = isBorderStyle(options.borderStyle) ? options.borderStyle : "double";
	const g = BORDER_GLYPHS[borderStyle];
	const borderColor = isPromptBorderColor(options.borderColor) ? options.borderColor : DEFAULT_SETTINGS.decorations.borderColor;
	const thinkingLevel = isThinkingLevel(options.thinkingLevel) ? options.thinkingLevel : undefined;
	const border = getThinkingLevelColorizer(theme, borderColor, thinkingLevel);
	const iconColor = (text: string) => theme.fg("text", text);
	const label = (text: string) => theme.fg("customMessageLabel", text);
	const muted = (text: string) => theme.fg("dim", text);
	const bodyText = (text: string) => theme.fg("customMessageText", text);
	const time = options.showTimestamp === false || !submittedAt
		? ""
		: new Date(submittedAt).toLocaleTimeString("en-GB", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	const innerWidth = width - 2;
	const rawIcon = options.icon ?? "";
	const icon = options.showIcon === false || typeof rawIcon !== "string"
		? ""
		: stripControlChars(rawIcon);
	const provider = options.showProvider === false || typeof options.provider !== "string"
		? ""
		: stripControlChars(options.provider);
	const model = options.showModel === false || typeof options.model !== "string"
		? ""
		: stripControlChars(options.model);
	const combinedLabel = [provider, model].filter(Boolean).join("/");
	// truncateToWidth injects reset codes when clipping; remove them before muted() styles the label.
	const labelText = combinedLabel
		? truncateToWidth(combinedLabel, Math.max(0, innerWidth - 3)).replace(/\x1b\[0m/g, "")
		: "";
	const titleLength = icon ? visibleWidth(`${g.h}${g.h} ${icon} `) : 0;
	const timeLength = time ? time.length + 3 : 0; // time + right-side " ═"
	const topFill = Math.max(0, innerWidth - titleLength - timeLength);
	const iconSeg = icon ? `${border(`${g.h}${g.h} `)}${iconColor(icon)}${border(" ")}` : "";
	const timeSeg = time ? `${border(" ")}${muted(time)}${border(` ${g.h}`)}` : "";
	const topLine = border(g.tl) + iconSeg + border(g.h.repeat(topFill)) + timeSeg + border(g.tr);
	const lines = [visibleWidth(topLine) > width ? truncateToWidth(topLine, width) : topLine];

	if (content) {
		const textWidth = innerWidth - 2;
		for (const rawLine of wrapTextWithAnsi(content, textWidth)) {
			const displayLine = rawLine || " ";
			const padded = `${displayLine}${" ".repeat(Math.max(0, textWidth - visibleWidth(displayLine)))}`;
			const line = `${border(g.v)}${bodyText(` ${padded} `)}${border(g.v)}`;
			lines.push(visibleWidth(line) > width ? truncateToWidth(line, width) : line);
		}
	}

	const labelLength = labelText ? visibleWidth(labelText) + 3 : 0; // label + right-side " ═"
	const labelSeg = labelText ? `${border(" ")}${muted(labelText)}${border(` ${g.h}`)}` : "";
	const bottomLine = `${border(g.bl)}${border(g.h.repeat(Math.max(0, innerWidth - labelLength)))}${labelSeg}${border(g.br)}`;
	lines.push(visibleWidth(bottomLine) > width ? truncateToWidth(bottomLine, width) : bottomLine);
	return lines;
}

export const promptBoxRenderer: MessageRenderer<PromptBoxDetails> = (message, _options, theme) => {
	const content = typeof message.content === "string" ? message.content.replace(/(?![\n\t])[\p{Cc}\p{Cf}]/gu, "") : "";
	const details = (message.details ?? {}) as PromptBoxDetails;
	let cachedWidth: number | undefined;
	let cachedLines: string[] | undefined;
	return {
		render(width: number): string[] {
			if (cachedWidth !== width) {
				cachedWidth = width;
				cachedLines = buildPromptBoxLines(content, details.submittedAt, width, theme, details);
			}
			return cachedLines!;
		},
		invalidate() {
			cachedWidth = undefined;
			cachedLines = undefined;
		},
	};
};
