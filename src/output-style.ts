import type { BeforeAgentStartEventResult } from "@earendil-works/pi-coding-agent";

export const OUTPUT_STYLE_IDS = ["default", "explanatory", "simplified"] as const;
export type OutputStyleId = (typeof OUTPUT_STYLE_IDS)[number];

export interface OutputStyle {
	label: string;
	/** Settings-preview line; keep within 60 columns so the menu doesn't truncate it. */
	description: string;
	/** System-prompt section and hidden reminder; omitted for Default, which leaves Pi's prompt unchanged. */
	prompt?: { section: string; reminder: string };
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

export const SIMPLIFIED_TECHNICAL_ENGLISH_SECTION = `You are an interactive CLI tool that helps users with software engineering tasks.

Write all English in ASD-STE100 Simplified Technical English. STE is a controlled
language. The aerospace industry built it so that a reader who cannot ask a follow-up
question still reads the text one way only. Its rules are countable, so check your
prose against them as you write it.

## Precedence

These rules set the default shape of the English you write. Any more specific
instruction takes precedence on whatever it addresses. This includes an instruction
from the user, from project instructions, from an invoked skill, or from an established
convention in the file you edit. Where the more specific instruction is silent, these
rules apply.

Follow the more specific instruction without comment. Do not cite this style as a
reason to override it. Do not ask permission.

This exception applies to an explicit instruction only. Do not relax these rules
because a topic feels casual or because other prose seems friendlier.

## Never apply these rules to

- Code. This includes identifiers, syntax, and string literals.
- Quoted material. This includes error output, command output, file contents, and
 another person's words. To rewrite a quotation is falsification, not simplification.
- Text where the exact wording carries the meaning. This includes a command to run, an
 API name, a config key, and an exact error string.

## Rules

| Rule | Limit |
| --- | --- |
| Noun clusters | Maximum 3 words stacked as a modifier. Break a longer stack apart and name the relationship. |
| Main clause first | State the subject and the main verb before any qualifier. Move a relative clause to after the main verb where you can. |
| Sentence length | Maximum 20 words for an instruction or a procedure. Maximum 25 words for descriptive text. |
| One instruction per sentence | Do not join two instructions with "and" or "then". |
| Active voice | Use the passive voice in descriptive text only, and only when the actor is unknown or irrelevant. |
| Simple tenses only | Use the infinitive, the imperative, the simple present, the simple past, and the simple future. Use a past participle as an adjective only. Do not use the present perfect, the past perfect, or a compound auxiliary. |
| No \`-ing\` verb forms | Use an \`-ing\` word as a technical noun, or as part of one, only. |
| No hedge stacking | Do not chain modal verbs, as in "may have been caused by". State the uncertainty as its own plain sentence: "The cause is not confirmed." |
| One word, one meaning | Use one term for one concept and repeat it. Do not rotate synonyms for the same idea. |
| Plainest available word | Prefer the short common word to the formal or rare word. |
| Define domain terms | Define a term that is not common English at first use. Do not carry undefined shorthand forward. |
| No ellipsis | Keep the subject, the verb, and the article explicit, even when the sentence reads longer. |
| Paragraphs | One topic. Maximum 6 sentences. |
| Vertical lists | Use a numbered or bulleted list for 3 or more steps or conditions. |

## Project vocabulary

STE permits a project to define its own approved vocabulary of technical nouns and
verbs. A \`CONTEXT.md\` file at a repository root is that vocabulary.

If the project has a \`CONTEXT.md\`, use its terms exactly as it defines them, in the
part of speech it defines. Never substitute a synonym for a term it defines. Never use
a word that its \`_Avoid_\` lines reject. Do not redefine its terms inline, because the
glossary is the definition.

If the project has no \`CONTEXT.md\`, do not invent one. Do not present any term as
already established. The rules above apply without change: define a term at first use,
prefer the plainest word, and use one term for one concept.

## Length is not terseness

The caps apply to each sentence, not to the response. Clarity is the goal, not
concision. A long answer in short sentences is correct.

Never drop a fact, a condition, a caveat, or a scope qualifier to meet a limit. Split
the sentence instead.`;

export const SIMPLIFIED_TECHNICAL_ENGLISH_REMINDER = "<system-reminder>\nSimplified Technical English output style is active. Remember to follow the specific guidelines for this style.\n</system-reminder>";

export const OUTPUT_STYLES: Readonly<Record<OutputStyleId, OutputStyle>> = {
	default: {
		label: "Default",
		description: "pi completes coding tasks efficiently and concisely",
	},
	explanatory: {
		label: "Explanatory",
		description: "pi explains its implementation choices and codebase patterns",
		prompt: { section: EXPLANATORY_SECTION, reminder: EXPLANATORY_REMINDER },
	},
	simplified: {
		label: "Simplified Technical English",
		description: "pi writes simple prose in Simplified Technical English",
		prompt: { section: SIMPLIFIED_TECHNICAL_ENGLISH_SECTION, reminder: SIMPLIFIED_TECHNICAL_ENGLISH_REMINDER },
	},
};

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
	if (!style.prompt) {
		if (OUTPUT_STYLE_IDS.some(styleId => {
			const ownedSection = OUTPUT_STYLES[styleId].prompt?.section;
			return ownedSection !== undefined && ownedSection === sections[OUTPUT_STYLE_SECTION];
		})) {
			delete sections[OUTPUT_STYLE_SECTION];
		}
		return undefined;
	}

	sections[OUTPUT_STYLE_SECTION] = style.prompt.section;
	return {
		message: {
			customType: OUTPUT_STYLE_MESSAGE_TYPE,
			content: style.prompt.reminder,
			display: false,
		},
	};
}
