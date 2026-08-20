import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { atomicWriteFile } from "./settings.ts";
import { isPlainObject } from "./util.ts";

const setupCheckPath = (): string => join(getAgentDir(), "pi-topping", "setup-check.json");

export function isSetupCheckDisabled(): boolean {
	try {
		const parsed: unknown = JSON.parse(readFileSync(setupCheckPath(), "utf8"));
		return isPlainObject(parsed) && parsed.disabled === true;
	} catch {
		return false;
	}
}

export function setSetupCheckDisabled(disabled: boolean): void {
	atomicWriteFile(setupCheckPath(), `${JSON.stringify({ disabled })}\n`);
}
