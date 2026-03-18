import { Data } from "effect";

/**
 * Error when token permissions are insufficient or over-scoped.
 *
 * @public
 */
export class TokenPermissionError extends Data.TaggedError("TokenPermissionError")<{
	/** Permissions that are missing or insufficient. */
	readonly missing: Array<{ permission: string; required: string; granted?: string }>;

	/** Permissions granted but not required. */
	readonly extra?: Array<{ permission: string; level: string }>;

	/** Human-readable description of the permission issue. */
	readonly reason: string;
}> {}
