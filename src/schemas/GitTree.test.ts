import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { FileChange, TreeEntry } from "./GitTree.js";

describe("TreeEntry", () => {
	it("decodes a valid tree entry", () => {
		const input = { path: "src/index.ts", mode: "100644", content: "export {}" };
		const result = Schema.decodeUnknownSync(TreeEntry)(input);
		expect(result).toEqual(input);
	});

	it("accepts executable mode", () => {
		const input = { path: "bin/cli", mode: "100755", content: "#!/usr/bin/env node" };
		expect(Schema.decodeUnknownSync(TreeEntry)(input)).toEqual(input);
	});

	it("accepts directory mode", () => {
		const input = { path: "src", mode: "040000", content: "" };
		expect(Schema.decodeUnknownSync(TreeEntry)(input)).toEqual(input);
	});

	it("rejects invalid mode", () => {
		const input = { path: "file.txt", mode: "999999", content: "data" };
		expect(() => Schema.decodeUnknownSync(TreeEntry)(input)).toThrow();
	});
});

describe("FileChange", () => {
	it("decodes a valid file change", () => {
		const input = { path: "README.md", content: "# Hello" };
		const result = Schema.decodeUnknownSync(FileChange)(input);
		expect(result).toEqual(input);
	});

	it("rejects missing content", () => {
		expect(() => Schema.decodeUnknownSync(FileChange)({ path: "file.txt" })).toThrow();
	});
});
