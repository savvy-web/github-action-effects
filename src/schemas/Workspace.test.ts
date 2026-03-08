import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { WorkspaceInfo, WorkspacePackage, WorkspaceType } from "./Workspace.js";

describe("WorkspaceType", () => {
	it("accepts valid types", () => {
		for (const type of ["single", "pnpm", "yarn", "npm", "bun"]) {
			expect(Schema.decodeUnknownSync(WorkspaceType)(type)).toBe(type);
		}
	});

	it("rejects invalid type", () => {
		expect(() => Schema.decodeUnknownSync(WorkspaceType)("lerna")).toThrow();
	});
});

describe("WorkspaceInfo", () => {
	it("decodes valid workspace info", () => {
		const input = { root: "/workspace", type: "pnpm", patterns: ["packages/*"] };
		const result = Schema.decodeUnknownSync(WorkspaceInfo)(input);
		expect(result).toEqual(input);
	});

	it("rejects invalid workspace type", () => {
		expect(() =>
			Schema.decodeUnknownSync(WorkspaceInfo)({ root: "/workspace", type: "invalid", patterns: [] }),
		).toThrow();
	});
});

describe("WorkspacePackage", () => {
	it("decodes valid workspace package", () => {
		const input = {
			name: "@scope/pkg",
			version: "1.0.0",
			path: "packages/pkg",
			private: false,
			dependencies: { effect: "^3.0.0" },
		};
		const result = Schema.decodeUnknownSync(WorkspacePackage)(input);
		expect(result).toEqual(input);
	});

	it("rejects missing private field", () => {
		expect(() =>
			Schema.decodeUnknownSync(WorkspacePackage)({
				name: "pkg",
				version: "1.0.0",
				path: "packages/pkg",
				dependencies: {},
			}),
		).toThrow();
	});
});
