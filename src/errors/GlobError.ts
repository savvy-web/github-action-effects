import { Data } from "effect";

/**
 * Error when a glob operation (pattern resolution or hashFiles) fails.
 *
 * @public
 */
export class GlobError extends Data.TaggedError("GlobError")<{
	/** The operation that failed. */
	readonly operation: "glob" | "hashFiles";
	/** The patterns string involved. */
	readonly patterns: string;
	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
