import { Data } from "effect";

/**
 * Error when a semver operation fails due to invalid input.
 */
export class SemverResolverError extends Data.TaggedError("SemverResolverError")<{
	/** The operation that failed. */
	readonly operation: "compare" | "satisfies" | "latestInRange" | "increment" | "parse";

	/** The version string involved. */
	readonly version: string;

	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
