import { Redacted } from "effect";

/**
 * Unwrap a value that may be a plain string or a `Redacted` wrapper into a
 * plain string. Use only at genuine wire boundaries (Octokit `auth`,
 * `createAppAuth`, request bearer, npm auth write).
 */
export const unwrapRedacted = (value: string | Redacted.Redacted<string>): string =>
	typeof value === "string" ? value : Redacted.value(value);

/**
 * Normalize a value that may be a plain string or a `Redacted` wrapper into a
 * `Redacted<string>`. Used by the optional-override sites that still accept a
 * `string | Redacted` union so the secret stays redacted everywhere internally.
 */
export const toRedacted = (value: string | Redacted.Redacted<string>): Redacted.Redacted<string> =>
	typeof value === "string" ? Redacted.make(value) : value;
