/** pi-topping extension entry point. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "./session.ts";

export default function (pi: ExtensionAPI): void {
	new SessionManager(pi).install();
}
