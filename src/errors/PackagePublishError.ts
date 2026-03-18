import { Data } from "effect";

/**
 * Error from package publishing operations.
 */
export class PackagePublishError extends Data.TaggedError("PackagePublishError")<{
	/** The operation that failed. */
	readonly operation: "setupAuth" | "pack" | "publish" | "verifyIntegrity" | "publishToRegistries";

	/** The package name, if applicable. */
	readonly pkg?: string;

	/** The registry URL, if applicable. */
	readonly registry?: string;

	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
