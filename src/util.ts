/** True for object records, excluding arrays and null. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strip control and formatting characters from untrusted single-line text. */
export function stripControlChars(text: string): string {
	return text.replace(/[\p{Cc}\p{Cf}]/gu, "");
}

export function sanitizedText(value: unknown): string {
	return typeof value === "string" ? stripControlChars(value).trim() : "";
}

/**
 * True when `version` is a release older than `minimum`, both read as `major.minor.patch`.
 * A value that does not start with three numbers cannot be compared and counts as new enough;
 * a pre-release suffix is ignored.
 */
export function hostBelow(version: string, minimum: string): boolean {
	const parse = (text: string): number[] | undefined => {
		const match = /^(\d+)\.(\d+)\.(\d+)/.exec(text.trim());
		return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
	};
	const actual = parse(version);
	const floor = parse(minimum);
	if (!actual || !floor) return false;
	for (let i = 0; i < 3; i++) {
		if (actual[i] !== floor[i]) return actual[i]! < floor[i]!;
	}
	return false;
}

/** True when a reported response model appears to be a decorated form of the selected model. */
export function modelsResemble(selectedModel?: string, responseModel?: string): boolean {
	if (!selectedModel || !responseModel) return false;
	const selectedName = selectedModel.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
	const selectedTokens = selectedName.match(/[a-z0-9]{2,}/g) ?? [];
	const normalizedResponse = responseModel.toLowerCase();
	return selectedTokens.length > 0 && selectedTokens.every((token) => normalizedResponse.includes(token));
}

/** Lowercase letters and digits only, so names that differ just in case and separators compare equal. */
function spelling(text: string): string {
	return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * True when a reported response model is the selected model's id, or its display name with or
 * without trailing parenthesized notes, written with other case and separators: a model named
 * `Qwen3.8 Flash (Local)` matches `qwen3.8-flash`. Every digit counts, so `qwen3-flash` does not,
 * and nothing else may differ, so an id with a suffix such as `256k` does not match a response without it.
 */
export function modelsSpelledAlike(selected: { id: string; name?: string }, responseModel?: string): boolean {
	if (!responseModel) return false;
	const lastSegment = (model: string): string => model.split(/[\\/]/).at(-1) ?? "";
	const response = spelling(lastSegment(responseModel));
	if (!response) return false;
	const name = selected.name ?? "";
	const candidates = [lastSegment(selected.id), name, name.replace(/(?:\s*\([^()]*\))+\s*$/, "")];
	return candidates.some((candidate) => spelling(candidate) === response);
}
