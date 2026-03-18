import { Data } from "effect";

/**
 * Error when a shell command fails or produces unexpected output.
 */
export class CommandRunnerError extends Data.TaggedError("CommandRunnerError")<{
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
}> {
	get message(): string {
		const cmd = this.args.length > 0 ? `${this.command} ${this.args.join(" ")}` : this.command;
		const parts = [`Command "${cmd}" failed`];
		if (this.exitCode !== undefined) parts.push(`(exit ${this.exitCode})`);
		if (this.stderr) parts.push(`: ${this.stderr.slice(0, 500)}`);
		return parts.join(" ");
	}
}
