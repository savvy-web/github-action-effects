import { Data } from "effect";

/**
 * Base class for CommandRunnerError.
 *
 * @internal
 */
export const CommandRunnerErrorBase = Data.TaggedError("CommandRunnerError");

/**
 * Error when a shell command fails or produces unexpected output.
 */
export class CommandRunnerError extends CommandRunnerErrorBase<{
	/** The command that was executed. */
	readonly command: string;

	/** The arguments passed to the command. */
	readonly args: ReadonlyArray<string>;

	/** The exit code, if available. */
	readonly exitCode: number | undefined;

	/** Captured stderr output, if available. */
	readonly stderr: string | undefined;

	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
