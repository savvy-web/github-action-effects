import { Data } from "effect";

/**
 * Error raised by SLSA helpers.
 *
 * - `"decode"` — JWT payload could not be decoded
 * - `"claims"` — decoded JWT is missing required claims
 * - `"env"`    — predicate could not be assembled from the runner environment
 *
 * @public
 */
export class SlsaError extends Data.TaggedError("SlsaError")<{
	readonly reason: "decode" | "claims" | "env";
	readonly message: string;
	readonly cause?: unknown;
}> {}
