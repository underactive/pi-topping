import type { MessageRenderer, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { isSettingColor } from "./settings.ts";

export const PROMPT_BOX_TYPE = "pi-topping-prompt";

export type BorderStyle = "double" | "single" | "rounded" | "heavy";

const BORDER_GLYPHS: Record<BorderStyle, { tl: string; tr: string; bl: string; br: string; h: string; v: string }> = {
	double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
	single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
	rounded: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" },
	heavy: { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" },
};

export interface PromptBoxDetails {
	submittedAt?: number;
	showIcon?: boolean;
	showTimestamp?: boolean;
	icon?: string;
	borderColor?: ThemeColor;
	borderStyle?: BorderStyle;
}

type PromptTheme = { fg(color: string, text: string): string };

/** Build the rendered lines for a decorated user prompt. */
export function buildPromptBoxLines(
	content: string,
	submittedAt: number | undefined,
	width: number,
	theme: PromptTheme,
	options: PromptBoxDetails = {},
): string[] {
	if (width < 10) return [];

	const borderStyle = options.borderStyle && options.borderStyle in BORDER_GLYPHS ? options.borderStyle : "double";
	const g = BORDER_GLYPHS[borderStyle];
	const borderColor = isSettingColor(options.borderColor) ? options.borderColor : "accent";
	const border = (text: string) => theme.fg(borderColor, text);
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
	const icon = options.showIcon === false ? "" : (options.icon ?? "").replace(/[\x00-\x1f\x7f]/g, "");
	const titleLength = icon ? visibleWidth(`${g.h}${g.h} ${icon} `) : 0;
	const timeLength = time ? time.length + 3 : 0; // time + right-side " ═"
	const topFill = Math.max(0, innerWidth - titleLength - timeLength);
	const iconSeg = icon ? `${border(`${g.h}${g.h} `)}${label(icon)}${border(" ")}` : "";
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

	const bottomLine = `${border(g.bl)}${border(g.h.repeat(innerWidth))}${border(g.br)}`;
	lines.push(visibleWidth(bottomLine) > width ? truncateToWidth(bottomLine, width) : bottomLine);
	return lines;
}

export const promptBoxRenderer: MessageRenderer<PromptBoxDetails> = (message, _options, theme) => {
	const content = typeof message.content === "string" ? message.content.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "") : "";
	const details = (message.details ?? {}) as PromptBoxDetails;
	const linesByWidth = new Map<number, string[]>();
	return {
		render(width: number): string[] {
			let lines = linesByWidth.get(width);
			if (!lines) {
				lines = buildPromptBoxLines(content, details.submittedAt, width, theme, details);
				linesByWidth.set(width, lines);
			}
			return lines;
		},
		invalidate() { linesByWidth.clear(); },
	};
};
