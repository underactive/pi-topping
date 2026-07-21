import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export const PROMPT_BOX_TYPE = "pi-topping-prompt";

export interface PromptBoxDetails {
	submittedAt?: number;
	showIcon?: boolean;
	showTimestamp?: boolean;
	icon?: string;
	borderColor?: "accent" | "border" | "borderAccent";
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

	const border = (text: string) => theme.fg(options.borderColor ?? "accent", text);
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
	const icon = options.showIcon === false ? "" : (options.icon ?? "");
	const title = icon ? `══ ${icon} ` : "";
	const titleLength = visibleWidth(title);
	const timeLength = time ? time.length + 3 : 0; // time + right-side " ═"
	const topFill = Math.max(0, innerWidth - titleLength - timeLength);
	const topLine = `${border("╔")}${icon ? `${border("══ ")}${label(icon)}${border(" ")}` : ""}${border("═".repeat(topFill))}${time ? `${border(" ")}${muted(time)}${border(" ═")}` : ""}${border("╗")}`;
	const lines = [visibleWidth(topLine) > width ? truncateToWidth(topLine, width) : topLine];

	if (content) {
		const textWidth = innerWidth - 2;
		for (const rawLine of wrapTextWithAnsi(content, textWidth)) {
			const displayLine = rawLine || " ";
			const padded = `${displayLine}${" ".repeat(Math.max(0, textWidth - visibleWidth(displayLine)))}`;
			const line = `${border("║")}${bodyText(` ${padded} `)}${border("║")}`;
			lines.push(visibleWidth(line) > width ? truncateToWidth(line, width) : line);
		}
	}

	const bottomLine = `${border("╚")}${border("═".repeat(innerWidth))}${border("╝")}`;
	lines.push(visibleWidth(bottomLine) > width ? truncateToWidth(bottomLine, width) : bottomLine);
	return lines;
}

export const promptBoxRenderer: MessageRenderer<PromptBoxDetails> = (message, _options, theme) => {
	const content = typeof message.content === "string" ? message.content : "";
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
