import { Redacted } from "effect";

/**
 * Unwrap a value that may be a plain string or a `Redacted` wrapper into a
 * plain string. Shared by the token-accepting constructors.
 */
export const unwrapRedacted = (value: string | Redacted.Redacted<string>): string =>
	typeof value === "string" ? value : Redacted.value(value);
