import { Effect, Layer, Schema } from "effect";
import { CommandRunnerError } from "../errors/CommandRunnerError.js";
import type { ExecOutput } from "../services/CommandRunner.js";
import { CommandRunner } from "../services/CommandRunner.js";

/**
 * Recorded command response for testing.
 *
 * @public
 */
export interface CommandResponse {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

const defaultResponse: CommandResponse = { exitCode: 0, stdout: "", stderr: "" };

const makeKey = (command: string, args: ReadonlyArray<string>): string =>
	args.length > 0 ? `${command} ${[...args].join(" ")}` : command;

const makeTestRunner = (responses: ReadonlyMap<string, CommandResponse>): typeof CommandRunner.Service => {
	const lookup = (command: string, args: ReadonlyArray<string>): CommandResponse => {
		const key = makeKey(command, args);
		return responses.get(key) ?? responses.get(command) ?? defaultResponse;
	};

	const failOnNonZero = (
		command: string,
		args: ReadonlyArray<string>,
		response: CommandResponse,
	): Effect.Effect<ExecOutput, CommandRunnerError> =>
		response.exitCode === 0
			? Effect.succeed(response)
			: Effect.fail(
					new CommandRunnerError({
						command,
						args,
						exitCode: response.exitCode,
						stderr: response.stderr,
						reason: `Command exited with code ${response.exitCode}`,
					}),
				);

	return {
		exec: (command, args = []) => {
			const response = lookup(command, args);
			return failOnNonZero(command, args, response).pipe(Effect.map((r) => r.exitCode));
		},

		execCapture: (command, args = []) => {
			const response = lookup(command, args);
			return failOnNonZero(command, args, response);
		},

		execJson: (command, args, schema) => {
			const resolvedArgs = args ?? [];
			const response = lookup(command, resolvedArgs);
			return failOnNonZero(command, resolvedArgs, response).pipe(
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

		execLines: (command, args = []) => {
			const response = lookup(command, args);
			return failOnNonZero(command, args, response).pipe(
				Effect.map((output) =>
					output.stdout
						.split("\n")
						.map((line) => line.trim())
						.filter((line) => line.length > 0),
				),
			);
		},
	};
};

/**
 * Test implementation for CommandRunner.
 *
 * @public
 */
export const CommandRunnerTest = {
	/** Create a test layer with recorded command responses. Key is "command args..." */
	layer: (responses: ReadonlyMap<string, CommandResponse>): Layer.Layer<CommandRunner> =>
		Layer.succeed(CommandRunner, makeTestRunner(responses)),

	/** Create a test layer where all commands succeed with empty output. */
	empty: (): Layer.Layer<CommandRunner> => Layer.succeed(CommandRunner, makeTestRunner(new Map())),
} as const;
