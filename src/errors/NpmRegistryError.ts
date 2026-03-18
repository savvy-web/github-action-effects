import { Data } from "effect";

/**
 * Error from npm registry operations.
 */
export class NpmRegistryError extends Data.TaggedError("NpmRegistryError")<{
	readonly pkg: string;
	readonly operation: "view" | "search" | "versions";
	readonly reason: string;
}> {}
