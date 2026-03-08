import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { BumpType, Changeset, ChangesetFile } from "./Changeset.js";

describe("BumpType", () => {
	it("accepts valid bump types", () => {
		expect(Schema.decodeUnknownSync(BumpType)("major")).toBe("major");
		expect(Schema.decodeUnknownSync(BumpType)("minor")).toBe("minor");
		expect(Schema.decodeUnknownSync(BumpType)("patch")).toBe("patch");
	});

	it("rejects invalid bump type", () => {
		expect(() => Schema.decodeUnknownSync(BumpType)("prerelease")).toThrow();
	});
});

describe("Changeset", () => {
	it("decodes a valid changeset", () => {
		const input = {
			id: "abc123",
			packages: [{ name: "@scope/pkg", bump: "minor" }],
			summary: "Added feature X",
		};
		const result = Schema.decodeUnknownSync(Changeset)(input);
		expect(result).toEqual(input);
	});

	it("rejects changeset with invalid bump", () => {
		const input = {
			id: "abc123",
			packages: [{ name: "@scope/pkg", bump: "invalid" }],
			summary: "Added feature X",
		};
		expect(() => Schema.decodeUnknownSync(Changeset)(input)).toThrow();
	});

	it("rejects changeset missing required fields", () => {
		expect(() => Schema.decodeUnknownSync(Changeset)({ id: "abc" })).toThrow();
	});
});

describe("ChangesetFile", () => {
	it("decodes a valid changeset file", () => {
		const input = { path: ".changeset/abc.md", content: "---\n@scope/pkg: minor\n---\nSummary" };
		const result = Schema.decodeUnknownSync(ChangesetFile)(input);
		expect(result).toEqual(input);
	});

	it("rejects missing path", () => {
		expect(() => Schema.decodeUnknownSync(ChangesetFile)({ content: "hello" })).toThrow();
	});
});
