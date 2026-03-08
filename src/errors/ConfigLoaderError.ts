import { Data } from "effect";

/**
 * Base class for ConfigLoaderError.
 *
 * @internal
 */
export const ConfigLoaderErrorBase = Data.TaggedError("ConfigLoaderError");

/**
 * Error from config loading operations.
 */
export class ConfigLoaderError extends ConfigLoaderErrorBase<{
	/** The file path that caused the error. */
	readonly path: string;

	/** The operation that failed. */
	readonly operation: "read" | "parse" | "validate";

	/** Human-readable description. */
	readonly reason: string;
}> {}
