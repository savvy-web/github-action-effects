import { Data } from "effect";

/**
 * Base class for PackageManagerError.
 *
 * @internal
 */
export const PackageManagerErrorBase = Data.TaggedError("PackageManagerError");

/**
 * Error from package manager operations.
 */
export class PackageManagerError extends PackageManagerErrorBase<{
	/** The package manager involved, if known. */
	readonly pm: string | undefined;

	/** The operation that failed. */
	readonly operation: "detect" | "install" | "cache" | "exec";

	/** Human-readable description. */
	readonly reason: string;
}> {}
