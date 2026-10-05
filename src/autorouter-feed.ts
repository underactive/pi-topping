import { isPlainObject, sanitizedText } from "./util.ts";

/**
 * Event-bus channel on which pi-topping-autorouter announces the physical model it routed
 * a request to, before Pi sends that request (so before `message_start`). Payload:
 *
 * ```json
 * {
 *   "version": 1,
 *   "provider": "openai-codex",
 *   "modelId": "gpt-5.6-sol",
 *   "model": "openai-codex/gpt-5.6-sol",
 *   "name": "GPT-5.6 Sol",
 *   "thinkingLevel": "high",
 *   "reason": "user",
 *   "cause": "jev_classifier",
 *   "tier": "COMPLEX",
 *   "ts": 1790000000000
 * }
 * ```
 *
 * `reason` is Pi's route reason: `user`, `continuation`, `retry`, or `direct`. `direct` routes
 * serve compaction summaries and other extensions' side requests, not the chat response.
 * `tier` may be absent. Shared with pi-topping-autorouter.
 */
export const ROUTED_MODEL_CHANNEL = "pi-topping-autorouter:routed-model";

const ROUTE_REASONS = ["user", "continuation", "retry", "direct"] as const;
export type RouteReason = (typeof ROUTE_REASONS)[number];

export interface RoutedModelAnnouncement {
	provider: string;
	modelId: string;
	reason: RouteReason;
}

function isRouteReason(value: string): value is RouteReason {
	return ROUTE_REASONS.some((reason) => reason === value);
}

/** The sanitized provider, model id, and route reason of a ROUTED_MODEL_CHANNEL announcement, or undefined if malformed. */
export function routedModelAnnouncement(data: unknown): RoutedModelAnnouncement | undefined {
	if (!isPlainObject(data) || data.version !== 1) return undefined;
	const provider = sanitizedText(data.provider);
	const modelId = sanitizedText(data.modelId);
	const reason = sanitizedText(data.reason);
	if (!provider || !modelId || !isRouteReason(reason)) return undefined;
	return { provider, modelId, reason };
}
