import { Data } from "effect";

/**
 * Base class for NpmRegistryError.
 *
 * @internal
 */
export const NpmRegistryErrorBase = Data.TaggedError("NpmRegistryError");

/**
 * Error from npm registry operations.
 */
export class NpmRegistryError extends NpmRegistryErrorBase<{
	readonly pkg: string;
	readonly operation: "view" | "search" | "versions";
	readonly reason: string;
}> {}
