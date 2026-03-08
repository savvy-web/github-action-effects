import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ExtraPermission, PermissionCheckResult, PermissionGap, PermissionLevel } from "./TokenPermission.js";

describe("PermissionLevel", () => {
	it("accepts valid levels", () => {
		expect(Schema.decodeUnknownSync(PermissionLevel)("read")).toBe("read");
		expect(Schema.decodeUnknownSync(PermissionLevel)("write")).toBe("write");
		expect(Schema.decodeUnknownSync(PermissionLevel)("admin")).toBe("admin");
	});

	it("rejects invalid level", () => {
		expect(() => Schema.decodeUnknownSync(PermissionLevel)("none")).toThrow();
	});
});

describe("PermissionGap", () => {
	it("decodes a gap with granted undefined", () => {
		const input = { permission: "contents", required: "write", granted: undefined };
		const result = Schema.decodeUnknownSync(PermissionGap)(input);
		expect(result.granted).toBeUndefined();
	});

	it("decodes a gap with granted level", () => {
		const input = { permission: "contents", required: "write", granted: "read" };
		const result = Schema.decodeUnknownSync(PermissionGap)(input);
		expect(result).toEqual(input);
	});

	it("rejects invalid required level", () => {
		expect(() => Schema.decodeUnknownSync(PermissionGap)({ permission: "contents", required: "superuser" })).toThrow();
	});
});

describe("ExtraPermission", () => {
	it("decodes a valid extra permission", () => {
		const input = { permission: "issues", level: "write" };
		const result = Schema.decodeUnknownSync(ExtraPermission)(input);
		expect(result).toEqual(input);
	});

	it("rejects missing level", () => {
		expect(() => Schema.decodeUnknownSync(ExtraPermission)({ permission: "issues" })).toThrow();
	});
});

describe("PermissionCheckResult", () => {
	it("decodes a full check result", () => {
		const input = {
			granted: { contents: "read" },
			required: { contents: "write" },
			missing: [{ permission: "contents", required: "write", granted: "read" }],
			extra: [],
			satisfied: false,
		};
		const result = Schema.decodeUnknownSync(PermissionCheckResult)(input);
		expect(result.satisfied).toBe(false);
		expect(result.missing).toHaveLength(1);
	});

	it("rejects non-boolean satisfied", () => {
		expect(() =>
			Schema.decodeUnknownSync(PermissionCheckResult)({
				granted: {},
				required: {},
				missing: [],
				extra: [],
				satisfied: "yes",
			}),
		).toThrow();
	});
});
