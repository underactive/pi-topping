import assert from "node:assert/strict";
import test from "node:test";

import { spawnPiInstall, spawnPiRemove } from "../src/pi-installer.ts";

for (const [name, runner] of [["install", spawnPiInstall], ["remove", spawnPiRemove]] as const) {
	test(`spawnPi${name} rejects unsafe or versioned specs without spawning`, async () => {
		for (const spec of [
			"npm:@underactive/pi topping-splash",
			"npm:@underactive/pi-topping-splash;echo",
			"npm:@underactive/pi-topping-splash@1.2.3",
		]) {
			assert.deepEqual(await runner(spec, 1), { code: 1, stdout: "", stderr: `invalid spec: ${spec}` });
		}
	});
}
