import type { Effect, Schema } from "effect";
import { Context } from "effect";
import type { CommandRunnerError } from "../errors/CommandRunnerError.js";

/**
 * Options for command execution.
 *
 * @public
 */
export interface ExecOptions {
	readonly cwd?: string;
	readonly env?: Record<string, string>;
	readonly timeout?: number;
	readonly silent?: boolean;
}

/**
 * Result of a captured command execution.
 *
 * @public
 */
export interface ExecOutput {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

/**
 * Service interface for structured shell command execution.
 *
 * @public
 */
export interface CommandRunner {
	/** Run a command and return exit code. Non-zero exit codes fail with CommandRunnerError. */
	readonly exec: (
		command: string,
		args?: ReadonlyArray<string>,
		options?: ExecOptions,
	) => Effect.Effect<number, CommandRunnerError>;

	/** Run a command and capture stdout/stderr. Non-zero exit codes fail with CommandRunnerError. */
	readonly execCapture: (
		command: string,
		args?: ReadonlyArray<string>,
		options?: ExecOptions,
	) => Effect.Effect<ExecOutput, CommandRunnerError>;

	/** Run a command, parse stdout as JSON, validate against schema. */
	readonly execJson: <A, I>(
		command: string,
		args: ReadonlyArray<string> | undefined,
		schema: Schema.Schema<A, I, never>,
		options?: ExecOptions,
	) => Effect.Effect<A, CommandRunnerError>;

	/** Run a command and return stdout split into trimmed, non-empty lines. */
	readonly execLines: (
		command: string,
		args?: ReadonlyArray<string>,
		options?: ExecOptions,
	) => Effect.Effect<ReadonlyArray<string>, CommandRunnerError>;
}

/**
 * CommandRunner tag for dependency injection.
 *
 * @public
 */
export const CommandRunner = Context.GenericTag<CommandRunner>("CommandRunner");
