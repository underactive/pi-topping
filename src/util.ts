/** True for object records, excluding arrays and null. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strip control and formatting characters from untrusted single-line text. */
export function stripControlChars(text: string): string {
	return text.replace(/[\p{Cc}\p{Cf}]/gu, "");
}

/** True when a reported response model appears to be a decorated form of the selected model. */
export function modelsResemble(selectedModel?: string, responseModel?: string): boolean {
	if (!selectedModel || !responseModel) return false;
	const selectedName = selectedModel.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
	const selectedTokens = selectedName.match(/[a-z0-9]{2,}/g) ?? [];
	const normalizedResponse = responseModel.toLowerCase();
	return selectedTokens.length > 0 && selectedTokens.every((token) => normalizedResponse.includes(token));
}
