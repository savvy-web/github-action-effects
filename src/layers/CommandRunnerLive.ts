import type { ExecOptions as ActionsExecOptions } from "@actions/exec";
import * as actionsExec from "@actions/exec";
import { Effect, Layer, Schema } from "effect";
import { CommandRunnerError } from "../errors/CommandRunnerError.js";
import type { ExecOptions, ExecOutput } from "../services/CommandRunner.js";
import { CommandRunner } from "../services/CommandRunner.js";

const runCapture = (
	command: string,
	args: ReadonlyArray<string>,
	options: ExecOptions | undefined,
): Effect.Effect<ExecOutput, CommandRunnerError> => {
	let stdout = "";
	let stderr = "";
	const execOpts: ActionsExecOptions = {
		silent: options?.silent ?? true,
		ignoreReturnCode: true,
		listeners: {
			stdout: (data: Buffer) => {
				stdout += data.toString();
			},
			stderr: (data: Buffer) => {
				stderr += data.toString();
			},
		},
	};
	if (options?.cwd !== undefined) execOpts.cwd = options.cwd;
	if (options?.env !== undefined) execOpts.env = options.env;
	if (options?.timeout !== undefined) execOpts.delay = options.timeout;

	return Effect.tryPromise({
		try: () => actionsExec.exec(command, [...args], execOpts),
		catch: (error) =>
			new CommandRunnerError({
				command,
				args,
				exitCode: undefined,
				stderr: undefined,
				reason: `Command execution failed: ${error instanceof Error ? error.message : String(error)}`,
			}),
	}).pipe(Effect.map((exitCode) => ({ exitCode, stdout, stderr })));
};

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

export const CommandRunnerLive: Layer.Layer<CommandRunner> = Layer.succeed(CommandRunner, {
	exec: (command, args = [], options?) =>
		runCapture(command, args, options).pipe(
			Effect.flatMap((output) => failOnNonZero(command, args, output)),
			Effect.map((output) => output.exitCode),
		),

	execCapture: (command, args = [], options?) =>
		runCapture(command, args, options).pipe(Effect.flatMap((output) => failOnNonZero(command, args, output))),

	execJson: (command, args, schema, options?) => {
		const resolvedArgs = args ?? [];
		return runCapture(command, resolvedArgs, options).pipe(
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
		runCapture(command, args, options).pipe(
			Effect.flatMap((output) => failOnNonZero(command, args, output)),
			Effect.map((output) =>
				output.stdout
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.length > 0),
			),
		),
});
