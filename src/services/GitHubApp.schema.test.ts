import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { InstallationToken } from "./GitHubApp.js";

describe("InstallationToken", () => {
	it("decodes a valid token with all fields", () => {
		const input = {
			token: "ghs_abc123",
			expiresAt: "2026-01-15T00:00:00Z",
			installationId: 12345,
			permissions: { contents: "read", issues: "write" },
		};
		const result = Schema.decodeUnknownSync(InstallationToken)(input);
		expect(result).toEqual(input);
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
