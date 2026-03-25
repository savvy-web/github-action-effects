import type { SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";
import { Effect, Layer, Schema } from "effect";
import { CommandRunnerError } from "../errors/CommandRunnerError.js";
import type { ExecOptions, ExecOutput } from "../services/CommandRunner.js";
import { CommandRunner } from "../services/CommandRunner.js";

/**
 * Escape an argument for safe use with cmd.exe on Windows.
 *
 * When `shell: true` is set, Node.js delegates to cmd.exe which interprets
 * metacharacters like `&`, `|`, `>`, `<`, `^`, `(`, `)`. Wrapping args in
 * double quotes neutralizes these. Internal double quotes are escaped with `\`.
 *
 * Limitation: `%VAR%` environment variable expansion still occurs inside
 * double quotes in cmd.exe. Callers must not pass untrusted values containing
 * `%`-delimited variable references.
 */
const escapeWindowsArg = (arg: string): string => {
	// If the arg is already quoted or contains no special characters, return as-is
	if (arg.startsWith('"') && arg.endsWith('"')) return arg;
	// Metacharacters that cmd.exe interprets outside of double quotes
	if (/[&|<>^() "!%]/.test(arg)) {
		return `"${arg.replace(/"/g, '\\"')}"`;
	}
	return arg;
};

const spawnCapture = (
	command: string,
	args: ReadonlyArray<string>,
	options: ExecOptions | undefined,
): Effect.Effect<ExecOutput, CommandRunnerError> =>
	Effect.async<ExecOutput, CommandRunnerError>((resume) => {
		const isWindows = process.platform === "win32";
		const spawnOpts: SpawnOptions = {
			stdio: "pipe",
			// Windows requires shell: true to resolve .cmd/.bat files (e.g., corepack.cmd).
			// Arguments are escaped via escapeWindowsArg to prevent shell injection.
			...(isWindows ? { shell: true } : {}),
			...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
			...(options?.env !== undefined ? { env: options.env as NodeJS.ProcessEnv } : {}),
			...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
		};

		// On Windows, escape args to prevent cmd.exe metacharacter injection
		const safeArgs = isWindows ? [...args].map(escapeWindowsArg) : [...args];
		const child = spawn(command, safeArgs, spawnOpts);

		let stdout = "";
		let stderr = "";
		const streaming = options?.streaming === true;

		(child.stdout as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
			if (streaming) process.stdout.write(chunk);
		});

		(child.stderr as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
			if (streaming) process.stderr.write(chunk);
		});

		child.on("error", (err: Error) => {
			resume(
				Effect.fail(
					new CommandRunnerError({
						command,
						args,
						exitCode: undefined,
						stderr: undefined,
						reason: `Command execution failed: ${err.message}`,
					}),
				),
			);
		});

		child.on("close", (code: number | null) => {
			resume(Effect.succeed({ exitCode: code ?? 1, stdout, stderr }));
		});
	});

const failOnNonZero = (
	command: string,
	args: ReadonlyArray<string>,
	output: ExecOutput,
): Effect.Effect<ExecOutput, CommandRunnerError> =>
	output.exitCode === 0
		? Effect.succeed(output)
		: Effect.fail(
				new CommandRunnerError({
					command,
					args,
					exitCode: output.exitCode,
					stderr: output.stderr,
					reason: `Command exited with code ${output.exitCode}`,
				}),
			);

export const CommandRunnerLive: Layer.Layer<CommandRunner> = Layer.succeed(
	CommandRunner,
	CommandRunner.of({
		exec: (command, args = [], options?) =>
			spawnCapture(command, args, options).pipe(
				Effect.flatMap((output) => failOnNonZero(command, args, output)),
				Effect.map((output) => output.exitCode),
			),

		execCapture: (command, args = [], options?) =>
			spawnCapture(command, args, options).pipe(Effect.flatMap((output) => failOnNonZero(command, args, output))),

		execJson: (command, args, schema, options?) => {
			const resolvedArgs = args ?? [];
			return spawnCapture(command, resolvedArgs, options).pipe(
				Effect.flatMap((output) => failOnNonZero(command, resolvedArgs, output)),
				Effect.flatMap((output) =>
					Effect.try({
						try: () => JSON.parse(output.stdout) as unknown,
						catch: () =>
							new CommandRunnerError({
								command,
								args: resolvedArgs,
								exitCode: output.exitCode,
								stderr: output.stderr,
								reason: `Failed to parse stdout as JSON: ${output.stdout.slice(0, 200)}`,
							}),
					}),
				),
				Effect.flatMap((parsed) =>
					Schema.decodeUnknown(schema)(parsed).pipe(
						Effect.mapError(
							() =>
								new CommandRunnerError({
									command,
									args: resolvedArgs,
									exitCode: 0,
									stderr: undefined,
									reason: "Command output did not match expected schema",
								}),
						),
					),
				),
			);
		},

		execLines: (command, args = [], options?) =>
			spawnCapture(command, args, options).pipe(
				Effect.flatMap((output) => failOnNonZero(command, args, output)),
				Effect.map((output) =>
					output.stdout
						.split("\n")
						.map((line) => line.trim())
						.filter((line) => line.length > 0),
				),
			),
	}),
);
