import { isPlainObject } from "./util.ts";

/**
 * Event-bus channel on which pi-topping-statusline announces, as `{ embedded: boolean }`,
 * whether its status bar hosts Pi's working loader. Shared with pi-topping-statusline.
 */
export const STATUSLINE_EMBED_CHANNEL = "pi-topping-statusline:working-status-embedded";

/** Whether an announcement on STATUSLINE_EMBED_CHANNEL says the status bar hosts the loader. */
export function announcesEmbedded(data: unknown): boolean {
	return isPlainObject(data) && data.embedded === true;
}
