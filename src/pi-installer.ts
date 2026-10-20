import {
	type PiInvocation,
	resolvePiInvocation,
	spawnCollect,
} from "@underactive/pi-topping-primitives/process";

export interface PiInstallResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface PiInstallOptions {
	/** Run this instead of the pi hosting the session. For tests, which must not start a real pi. */
	piInvocation?: PiInvocation;
}

const PACKAGE_SPEC = /^npm:@?[\w.-]+(\/[\w.-]+)?$/;

async function spawnPiPackageCommand(
	command: "install" | "remove",
	spec: string,
	timeoutMs: number,
	options: PiInstallOptions,
): Promise<PiInstallResult> {
	if (!PACKAGE_SPEC.test(spec)) {
		return { code: 1, stdout: "", stderr: `invalid spec: ${spec}` };
	}

	// The pi that hosts this session, so install and remove reach the same agent dir.
	const invocation = options.piInvocation
		? { command: options.piInvocation.command, args: [...options.piInvocation.args, command, spec], via: "script" as const }
		: resolvePiInvocation([command, spec]);

	let { command: executable, args } = invocation;
	// Only `pi` on PATH can be a Windows `.cmd` shim, which a shell-less spawn cannot start. The
	// spec was validated above, so it carries nothing for cmd.exe to re-parse.
	if (invocation.via === "path" && process.platform === "win32") {
		executable = "cmd.exe";
		args = ["/c", "pi", command, spec];
	}

	const { code, stdout, stderr } = await spawnCollect(executable, args, { timeoutMs, windowsHide: true });
	return { code, stdout, stderr };
}

/** Run `pi install <spec>` with the pi hosting this session; a Windows `pi` on PATH goes through `cmd.exe`. */
export function spawnPiInstall(spec: string, timeoutMs: number, options: PiInstallOptions = {}): Promise<PiInstallResult> {
	return spawnPiPackageCommand("install", spec, timeoutMs, options);
}

/** Run `pi remove <spec>` with the pi hosting this session; a Windows `pi` on PATH goes through `cmd.exe`. */
export function spawnPiRemove(spec: string, timeoutMs: number, options: PiInstallOptions = {}): Promise<PiInstallResult> {
	return spawnPiPackageCommand("remove", spec, timeoutMs, options);
}
