import { Data } from "effect";

/**
 * Error from config loading operations.
 */
export class ConfigLoaderError extends Data.TaggedError("ConfigLoaderError")<{
	/** The file path that caused the error. */
	readonly path: string;

	/** The operation that failed. */
	readonly operation: "read" | "parse" | "validate";

	/** Human-readable description. */
	readonly reason: string;
}> {}
