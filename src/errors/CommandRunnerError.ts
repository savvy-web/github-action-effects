import { Data } from "effect";

/**
 * Maximum stderr/stdout length surfaced in the formatted `message`. Tail-bound
 * because tools like `npm` write warnings and notices first and errors last;
 * surfacing the head would hide the real cause.
 *
 * @internal
 */
const MAX_OUTPUT_CHARS = 2000;

/**
 * Format a captured output stream for inclusion in the error message.
 *
 * @remarks
 * Returns the trimmed output when short; when longer than
 * {@link MAX_OUTPUT_CHARS}, returns a `...[N chars truncated]...\n<tail>`
 * shape so the actually-useful tail of stderr (where errors live) reaches
 * the reader.
 *
 * @internal
 */
const formatOutputTail = (output: string): string => {
	const trimmed = output.trim();
	if (trimmed.length <= MAX_OUTPUT_CHARS) return trimmed;
	return `...[${trimmed.length - MAX_OUTPUT_CHARS} chars truncated from head]...\n${trimmed.slice(-MAX_OUTPUT_CHARS)}`;
};

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

	/**
	 * Captured stdout output, if available. Carried alongside stderr because
	 * some CLIs (notably `npm`) emit progress, notices, and even error
	 * details on stdout; downstream errors can consult both.
	 */
	readonly stdout?: string | undefined;

	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {
	get message(): string {
		const cmd = this.args.length > 0 ? `${this.command} ${this.args.join(" ")}` : this.command;
		const parts = [`Command "${cmd}" failed`];
		if (this.exitCode !== undefined) parts.push(`(exit ${this.exitCode})`);
		// Prefer stderr (where errors live); fall back to stdout for tools that
		// route errors there. Show the tail when long — `npm` writes warnings
		// and notices first and the actual `npm error` lines at the end.
		const stream = this.stderr?.trim() ? this.stderr : this.stdout?.trim() ? this.stdout : undefined;
		if (stream !== undefined && stream.trim() !== "") {
			parts.push(`:\n${formatOutputTail(stream)}`);
		}
		return parts.join(" ");
	}
}
