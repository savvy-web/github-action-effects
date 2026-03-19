import type { Context } from "effect";
import { Effect, Layer, Schema } from "effect";
import { CommandRunnerError } from "../errors/CommandRunnerError.js";
import type { ActionsExecOptions } from "../services/ActionsExec.js";
import { ActionsExec } from "../services/ActionsExec.js";
import type { ExecOptions, ExecOutput } from "../services/CommandRunner.js";
import { CommandRunner } from "../services/CommandRunner.js";

type ActionsExecService = Context.Tag.Service<typeof ActionsExec>;

const buildExecOpts = (options: ExecOptions | undefined): ActionsExecOptions => {
	const opts: ActionsExecOptions = {
		silent: options?.silent ?? true,
		ignoreReturnCode: true,
		...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
		...(options?.env !== undefined ? { env: options.env } : {}),
		...(options?.timeout !== undefined ? { delay: options.timeout } : {}),
	};
	return opts;
};

const runCapture = (
	actionsExec: ActionsExecService,
	command: string,
	args: ReadonlyArray<string>,
	options: ExecOptions | undefined,
): Effect.Effect<ExecOutput, CommandRunnerError> => {
	let stdout = "";
	let stderr = "";
	const execOpts: ActionsExecOptions = {
		...buildExecOpts(options),
		listeners: {
			stdout: (data: Buffer) => {
				stdout += data.toString();
			},
			stderr: (data: Buffer) => {
				stderr += data.toString();
			},
		},
	};

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

export const CommandRunnerLive: Layer.Layer<CommandRunner, never, ActionsExec> = Layer.effect(
	CommandRunner,
	Effect.gen(function* () {
		const actionsExec = yield* ActionsExec;
		return {
			exec: (command, args = [], options?) =>
				runCapture(actionsExec, command, args, options).pipe(
					Effect.flatMap((output) => failOnNonZero(command, args, output)),
					Effect.map((output) => output.exitCode),
					Effect.withSpan("CommandRunner.exec", { attributes: { command } }),
				),

			execCapture: (command, args = [], options?) =>
				runCapture(actionsExec, command, args, options).pipe(
					Effect.flatMap((output) => failOnNonZero(command, args, output)),
					Effect.withSpan("CommandRunner.execCapture", { attributes: { command } }),
				),

			execJson: (command, args, schema, options?) => {
				const resolvedArgs = args ?? [];
				return runCapture(actionsExec, command, resolvedArgs, options).pipe(
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
					Effect.withSpan("CommandRunner.execJson", { attributes: { command } }),
				);
			},

			execLines: (command, args = [], options?) =>
				runCapture(actionsExec, command, args, options).pipe(
					Effect.flatMap((output) => failOnNonZero(command, args, output)),
					Effect.map((output) =>
						output.stdout
							.split("\n")
							.map((line) => line.trim())
							.filter((line) => line.length > 0),
					),
					Effect.withSpan("CommandRunner.execLines", { attributes: { command } }),
				),
		};
	}),
);
