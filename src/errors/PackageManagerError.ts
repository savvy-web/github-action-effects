import { Data } from "effect";

/**
 * Error from package manager operations.
 */
export class PackageManagerError extends Data.TaggedError("PackageManagerError")<{
	/** The package manager involved, if known. */
	readonly pm: string | undefined;

	/** The operation that failed. */
	readonly operation: "detect" | "install" | "cache" | "exec";

	/** Human-readable description. */
	readonly reason: string;
}> {}
