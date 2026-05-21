import { Redacted, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { InstallationToken } from "./GitHubApp.js";

describe("InstallationToken", () => {
	it("decodes a valid token with all fields (token becomes Redacted)", () => {
		const input = {
			token: "ghs_abc123",
			expiresAt: "2026-01-15T00:00:00Z",
			installationId: 12345,
			permissions: { contents: "read", issues: "write" },
		};
		const result = Schema.decodeUnknownSync(InstallationToken)(input);
		// `token` decodes to a Redacted wrapper; the rest is unchanged.
		expect(Redacted.isRedacted(result.token)).toBe(true);
		expect(Redacted.value(result.token)).toBe("ghs_abc123");
		expect(result.expiresAt).toBe(input.expiresAt);
		expect(result.installationId).toBe(input.installationId);
		expect(result.permissions).toEqual(input.permissions);
		// Encoding round-trips back to the raw token string for GITHUB_STATE.
		expect(Schema.encodeSync(InstallationToken)(result)).toEqual(input);
	});

	it("defaults permissions to empty object when omitted", () => {
		const input = {
			token: "ghs_abc123",
			expiresAt: "2026-01-15T00:00:00Z",
			installationId: 12345,
		};
		const result = Schema.decodeUnknownSync(InstallationToken)(input);
		expect(result.permissions).toEqual({});
	});

	it("rejects missing required fields", () => {
		expect(() => Schema.decodeUnknownSync(InstallationToken)({ token: "ghs_abc" })).toThrow();
	});

	it("rejects non-numeric installationId", () => {
		expect(() =>
			Schema.decodeUnknownSync(InstallationToken)({
				token: "ghs_abc",
				expiresAt: "2026-01-15T00:00:00Z",
				installationId: "not-a-number",
			}),
		).toThrow();
	});
});
