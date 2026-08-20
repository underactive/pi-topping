/** True for object records, excluding arrays and null. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Strip control and formatting characters from untrusted single-line text. */
export function stripControlChars(text: string): string {
	return text.replace(/[\p{Cc}\p{Cf}]/gu, "");
}
