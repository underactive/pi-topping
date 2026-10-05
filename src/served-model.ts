import { isPlainObject, stripControlChars } from "./util.ts";

export interface ServedModelReport {
	model: string;
	backend?: string;
}

function sanitizedLabel(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	return stripControlChars(raw).trim() || undefined;
}

/** Extract the served model and optional gateway backend from a raw Responses stream event. */
export function servedModelOf(data: unknown): ServedModelReport | undefined {
	try {
		if (!isPlainObject(data) || !isPlainObject(data.response)) return undefined;
		const model = sanitizedLabel(data.response.model);
		if (!model) return undefined;
		const rawBackend = data.provider;
		const backend = typeof rawBackend === "string" ? sanitizedLabel(rawBackend) : undefined;
		return { model, ...(backend ? { backend } : {}) };
	} catch {
		return undefined;
	}
}
