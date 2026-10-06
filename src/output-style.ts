import type { BeforeAgentStartEventResult } from "@earendil-works/pi-coding-agent";

export const OUTPUT_STYLE_IDS = ["default", "explanatory"] as const;
export type OutputStyleId = (typeof OUTPUT_STYLE_IDS)[number];

export interface OutputStyle {
	label: string;
	/** Settings-preview line; keep within 60 columns so the menu doesn't truncate it. */
	description: string;
	/** System-prompt section; omitted for Default, which leaves Pi's prompt unchanged. */
	section?: string;
	/** Hidden reminder sent with each prompt while the style is active. */
	reminder?: string;
	/** Footer status while the style is active. */
	status?: string;
}

// Matches figures.star from Claude Code: a fallback glyph on Windows, and ★ elsewhere.
export const INSIGHT_STAR = process.platform === "win32" ? "✶" : "★";

// Ported verbatim from claude-code/src/constants/outputStyles.ts:30-39.
export const EXPLANATORY_FEATURE_PROMPT = `
## Insights
In order to encourage learning, before and after writing code, always provide brief educational explanations about implementation choices using (with backticks):
"\`${INSIGHT_STAR} Insight ─────────────────────────────────────\`
[2-3 key educational points]
\`─────────────────────────────────────────────────\`"

These insights should be included in the conversation, not in the codebase. You should generally focus on interesting insights that are specific to the codebase or the code you just wrote, rather than general programming concepts.`;

export const OUTPUT_STYLE_SECTION = "output_style";
export const OUTPUT_STYLE_MESSAGE_TYPE = "pi-topping-output-style";

export const EXPLANATORY_SECTION = `# Output Style: Explanatory
Respond to the user according to this Output Style, which describes how you should respond to user queries.
You are an interactive CLI tool that helps users with software engineering tasks. In addition to software engineering tasks, you should provide educational insights about the codebase along the way.

You should be clear and educational, providing helpful explanations while remaining focused on the task. Balance educational content with task completion. When providing insights, you may exceed typical length constraints, but remain focused and relevant.
Insight blocks are the one exception to the "Be concise in your responses" rule; keep everything outside them concise.

# Explanatory Style Active
${EXPLANATORY_FEATURE_PROMPT}`;

export const EXPLANATORY_REMINDER = "<system-reminder>\nExplanatory output style is active. Remember to follow the specific guidelines for this style.\n</system-reminder>";

export const OUTPUT_STYLES: Readonly<Record<OutputStyleId, OutputStyle>> = {
	default: {
		label: "Default",
		description: "pi completes coding tasks efficiently and concisely",
	},
	explanatory: {
		label: "Explanatory",
		description: "pi explains its implementation choices and codebase patterns",
		section: EXPLANATORY_SECTION,
		reminder: EXPLANATORY_REMINDER,
		status: `${INSIGHT_STAR} Explanatory`,
	},
};

export const OUTPUT_STYLE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
	OUTPUT_STYLE_IDS.map(id => [id, OUTPUT_STYLES[id].label]),
);

export function isOutputStyleId(value: unknown): value is OutputStyleId {
	return typeof value === "string" && OUTPUT_STYLE_IDS.some(id => id === value);
}

/** Map the old pi-topping-insights style spelling to the current lowercase id. */
export function fromLegacyOutputStyle(value: unknown): OutputStyleId | undefined {
	if (value === "default") return "default";
	if (value === "Explanatory") return "explanatory";
	return undefined;
}

/**
 * Apply a style's prompt section and return its hidden reminder. Default removes the section only
 * when it holds one of these styles' text, so another extension's section survives. Hosts without
 * structured prompt sections get no change.
 */
export function applyOutputStyle(
	sections: Record<string, string> | undefined,
	id: OutputStyleId,
): BeforeAgentStartEventResult | undefined {
	if (!sections) return undefined;

	const style = OUTPUT_STYLES[id];
	if (style.section === undefined) {
		if (OUTPUT_STYLE_IDS.some(styleId => {
			const ownedSection = OUTPUT_STYLES[styleId].section;
			return ownedSection !== undefined && ownedSection === sections[OUTPUT_STYLE_SECTION];
		})) {
			delete sections[OUTPUT_STYLE_SECTION];
		}
		return undefined;
	}

	sections[OUTPUT_STYLE_SECTION] = style.section;
	if (!style.reminder) return undefined;
	return {
		message: {
			customType: OUTPUT_STYLE_MESSAGE_TYPE,
			content: style.reminder,
			display: false,
		},
	};
}
