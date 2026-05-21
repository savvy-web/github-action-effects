import { Data } from "effect";

/**
 * Error from package publishing operations.
 */
export class PackagePublishError extends Data.TaggedError("PackagePublishError")<{
	/** The operation that failed. */
	readonly operation:
		| "setupAuth"
		| "pack"
		| "publish"
		| "publishTarball"
		| "verifyIntegrity"
		| "publishToRegistries"
		| "publishIdempotent"
		| "dryRun";

	/** The package name, if applicable. */
	readonly pkg?: string;

	/** The registry URL, if applicable. */
	readonly registry?: string;

	/** Human-readable description of what went wrong. */
	readonly reason: string;

	/**
	 * The underlying error that caused this failure, when one exists — e.g. the
	 * `CommandRunnerError` from a failed `npm` invocation, which carries the
	 * command's `stderr`, `exitCode`, and `args`. Absent for errors constructed
	 * without a source error.
	 */
	readonly cause?: unknown;
}> {
	/**
	 * Human-readable summary: `[<operation>] <reason>`, with the underlying
	 * command's stderr (or stdout, as a fallback) appended when `cause`
	 * carries one. Output longer than 2000 chars is truncated from the
	 * **head** — `npm` writes warnings and notices first and the actual
	 * `npm error` lines at the end, so a head-truncation hides the cause
	 * while a tail-show surfaces it. A `...[N chars truncated from head]...`
	 * marker leads the truncated payload.
	 */
	get message(): string {
		let line = `[${this.operation}] ${this.reason}`;
		const cause = this.cause;
		if (typeof cause === "object" && cause !== null) {
			const c = cause as { stderr?: unknown; stdout?: unknown };
			const stderrStr = typeof c.stderr === "string" ? c.stderr.trim() : "";
			const stdoutStr = typeof c.stdout === "string" ? c.stdout.trim() : "";
			// Prefer stderr; fall back to stdout for tools that route errors
			// there. Combining both can produce noise — npm writes long notice
			// blocks to stdout that drown a short stderr error — so prefer one.
			const stream = stderrStr !== "" ? stderrStr : stdoutStr;
			if (stream !== "") {
				const MAX = 2000;
				const display =
					stream.length <= MAX
						? stream
						: `...[${stream.length - MAX} chars truncated from head]...\n${stream.slice(-MAX)}`;
				line += `:\n${display}`;
			}
		}
		return line;
	}
}
