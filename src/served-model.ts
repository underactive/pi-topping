import { isPlainObject, sanitizedText } from "./util.ts";

export interface ServedModelReport {
	model: string;
	backend?: string;
}

/** Extract the served model and optional gateway backend from a raw Responses stream event. */
export function servedModelOf(data: unknown): ServedModelReport | undefined {
	try {
		if (!isPlainObject(data) || !isPlainObject(data.response)) return undefined;
		const model = sanitizedText(data.response.model) || undefined;
		if (!model) return undefined;
		const backend = sanitizedText(data.provider);
		return { model, ...(backend ? { backend } : {}) };
	} catch {
		return undefined;
	}
}
