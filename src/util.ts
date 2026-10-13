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
