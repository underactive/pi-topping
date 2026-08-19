import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "./src/session.ts";

export default function (pi: ExtensionAPI): void {
	new SessionManager(pi).install();
}
