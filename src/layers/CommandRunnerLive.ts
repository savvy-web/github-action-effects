import type { SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";
import { Effect, Layer, Schema } from "effect";
import { CommandRunnerError } from "../errors/CommandRunnerError.js";
import type { ExecOptions, ExecOutput } from "../services/CommandRunner.js";
import { CommandRunner } from "../services/CommandRunner.js";

const spawnCapture = (
	command: string,
	args: ReadonlyArray<string>,
	options: ExecOptions | undefined,
): Effect.Effect<ExecOutput, CommandRunnerError> =>
	Effect.async<ExecOutput, CommandRunnerError>((resume) => {
		const spawnOpts: SpawnOptions = {
			stdio: "pipe",
			...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
			...(options?.env !== undefined ? { env: options.env as NodeJS.ProcessEnv } : {}),
			...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
		};

		const child = spawn(command, [...args], spawnOpts);

		let stdout = "";
		let stderr = "";

		(child.stdout as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});

		(child.stderr as NodeJS.ReadableStream).on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
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
