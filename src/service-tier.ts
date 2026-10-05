import { isPlainObject, sanitizedText } from "./util.ts";

/** Provider calls that reported one service tier during a run. */
export interface ServiceTierCount {
	tier: string;
	calls: number;
}

/** Sanitize a provider-supplied tier into a short, safe display label. */
export function sanitizeServiceTier(raw: unknown): string | undefined {
	let tier = sanitizedText(raw);
	if (tier.length > 32) {
		let end = 0;
		let characters = 0;
		for (const character of tier) {
			if (characters === 32) break;
			end += character.length;
			characters++;
		}
		tier = tier.slice(0, end);
	}
	return tier || undefined;
}

/**
 * Return the first sanitized tier reported in a raw provider stream event, without throwing.
 * OpenAI chat-completions uses `service_tier`; Responses uses `response.service_tier`;
 * Anthropic reports `message.usage.service_tier` at `message_start` and
 * `usage.service_tier` at `message_delta`. `serviceTier` covers camel-case adapters.
 */
export function serviceTierOf(data: unknown): string | undefined {
	try {
		if (!isPlainObject(data)) return undefined;
		const direct = sanitizeServiceTier(data.service_tier) ?? sanitizeServiceTier(data.serviceTier);
		if (direct) return direct;
		if (isPlainObject(data.response)) {
			const responseTier = sanitizeServiceTier(data.response.service_tier);
			if (responseTier) return responseTier;
		}
		if (isPlainObject(data.usage)) {
			const usageTier = sanitizeServiceTier(data.usage.service_tier);
			if (usageTier) return usageTier;
		}
		if (isPlainObject(data.message) && isPlainObject(data.message.usage)) {
			return sanitizeServiceTier(data.message.usage.service_tier);
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/** Increment a tier's provider-call count, appending new tiers in first-seen order. */
export function recordServiceTierCall(counts: ServiceTierCount[], tier: string): void {
	const existing = counts.find((entry) => entry.tier === tier);
	if (existing) existing.calls++;
	else counts.push({ tier, calls: 1 });
}

/** Validate persisted tier counts, dropping malformed entries and merging sanitized duplicates. */
export function serviceTierCountsOf(raw: unknown): ServiceTierCount[] {
	if (!Array.isArray(raw)) return [];
	const counts: ServiceTierCount[] = [];
	for (const item of raw) {
		if (!isPlainObject(item)) continue;
		const tier = sanitizeServiceTier(item.tier);
		const calls = item.calls;
		if (!tier || typeof calls !== "number" || !Number.isSafeInteger(calls) || calls <= 0) continue;
		const existing = counts.find((entry) => entry.tier === tier);
		if (existing) {
			const sum = existing.calls + calls;
			if (Number.isSafeInteger(sum)) existing.calls = sum;
		} else {
			counts.push({ tier, calls });
		}
	}
	return counts;
}

/** Format the ordered summary of provider calls that reported a tier. */
export function formatServiceTierSummary(counts: readonly ServiceTierCount[]): string {
	if (counts.length === 0) return "";
	const totalCalls = counts.reduce((total, entry) => total + entry.calls, 0);
	if (totalCalls === 1) return `${counts[0]!.tier} tier`;
	return counts.map(({ tier, calls }) => `${tier} tier ×${calls}`).join(", ");
}
