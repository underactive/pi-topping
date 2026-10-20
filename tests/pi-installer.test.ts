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

// A valid spec must never reach the default resolver under `node --test`: `process.argv[1]` is
// this test file, so the "pi" it found would be a re-run of the test. Each test injects a child.
const nodeChild = (script: string) => ({ command: process.execPath, args: ["-e", script] });

test("spawnPiInstall and spawnPiRemove pass the subcommand and spec to the injected pi and return its output", async () => {
	const echo = nodeChild('process.stdout.write(process.argv.slice(1).join("|")); process.stderr.write("warn"); process.exit(3)');
	assert.deepEqual(await spawnPiInstall("npm:@underactive/pi-topping-splash", 10_000, { piInvocation: echo }), {
		code: 3,
		stdout: "install|npm:@underactive/pi-topping-splash",
		stderr: "warn",
	});
	const removed = await spawnPiRemove("npm:@underactive/pi-topping-splash", 10_000, { piInvocation: echo });
	assert.equal(removed.stdout, "remove|npm:@underactive/pi-topping-splash");
});

test("a timeout maps to code 124 with the exact suffix, without waiting for a child that ignores SIGTERM", { skip: process.platform === "win32" }, async () => {
	// `sh` ignores SIGTERM from its first instruction, so the timeout's SIGTERM cannot end this child
	// (the escalation to SIGKILL waits out the default five-second grace, longer than the child
	// lives). It sleeps 1.5 s and then exits by itself, so a failed assertion leaves nothing behind.
	const stubborn = { command: "/bin/sh", args: ["-c", 'trap "" TERM; sleep 1.5'] };
	const started = Date.now();
	const result = await spawnPiInstall("npm:@underactive/pi-topping-splash", 50, { piInvocation: stubborn });
	const elapsed = Date.now() - started;
	assert.equal(result.code, 124);
	assert.equal(result.stderr, "[timed out after 50ms]");
	assert.equal(result.stdout, "");
	assert.ok(elapsed < 1000, `resolved after ${elapsed}ms: it waited for the child instead of timing out`);
});

test("a pi that cannot be started maps to code 1 with the error message", async () => {
	const result = await spawnPiInstall("npm:@underactive/pi-topping-splash", 5000, {
		piInvocation: { command: "/nonexistent/pt-no-such-pi", args: [] },
	});
	assert.equal(result.code, 1);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /ENOENT/);
});
