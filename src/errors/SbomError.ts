import { Data } from "effect";

/**
 * Errors raised by Sbom operations.
 *
 * - `"build"`     — failed to construct the Bom model (bad input)
 * - `"serialize"` — failed to serialize to JSON
 * - `"save"`      — failed to write the BOM file to disk
 *
 * @public
 */
export class SbomError extends Data.TaggedError("SbomError")<{
	readonly reason: "build" | "serialize" | "save";
	readonly message: string;
	readonly cause?: unknown;
}> {}
