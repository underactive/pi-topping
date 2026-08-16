import { spawn } from "node:child_process";

export interface PiInstallResult {
	code: number;
	stdout: string;
	stderr: string;
}

const SIGKILL_GRACE_MS = 5_000;
const EXIT_TIMEOUT = 124;

/** Run `pi install <spec>` without relying on Pi's shell-less exec wrapper on Windows. */
export function spawnPiInstall(spec: string, timeoutMs: number): Promise<PiInstallResult> {
	if (!/^npm:@?[\w.-]+(\/[\w.-]+)?$/.test(spec)) {
		return Promise.resolve({ code: 1, stdout: "", stderr: `invalid spec: ${spec}` });
	}
	return new Promise((resolve) => {
		const isWindows = process.platform === "win32";
		const [command, args, options] = isWindows
			? (["cmd.exe", ["/c", "pi", "install", spec], { windowsHide: true }] as const)
			: (["pi", ["install", spec], {}] as const);
		const processHandle = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let settled = false;
		let closed = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;

		const finish = (result: PiInstallResult): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutTimer);
			resolve(result);
		};

		const timeoutTimer = setTimeout(() => {
			processHandle.kill("SIGTERM");
			killTimer = setTimeout(() => {
				if (!closed) processHandle.kill("SIGKILL");
			}, SIGKILL_GRACE_MS);
			finish({
				code: EXIT_TIMEOUT,
				stdout,
				stderr: `${stderr}${stderr ? "\n" : ""}[timed out after ${timeoutMs}ms]`,
			});
		}, timeoutMs);

		processHandle.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		processHandle.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		processHandle.on("error", (error) => {
			finish({ code: 1, stdout, stderr: `${stderr}${stderr ? "\n" : ""}${error.message}` });
		});
		processHandle.on("close", (code) => {
			closed = true;
			if (killTimer !== undefined) clearTimeout(killTimer);
			finish({ code: code ?? 1, stdout, stderr });
		});
	});
}
