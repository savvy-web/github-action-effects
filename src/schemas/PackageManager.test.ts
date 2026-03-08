import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { PackageManagerInfo, PackageManagerName } from "./PackageManager.js";

describe("PackageManagerName", () => {
	it("accepts valid names", () => {
		for (const name of ["npm", "pnpm", "yarn", "bun", "deno"]) {
			expect(Schema.decodeUnknownSync(PackageManagerName)(name)).toBe(name);
		}
	});

	it("rejects invalid name", () => {
		expect(() => Schema.decodeUnknownSync(PackageManagerName)("cargo")).toThrow();
	});
});

describe("PackageManagerInfo", () => {
	it("decodes valid info", () => {
		const input = { name: "pnpm", version: "9.0.0", lockfile: "pnpm-lock.yaml" };
		const result = Schema.decodeUnknownSync(PackageManagerInfo)(input);
		expect(result).toEqual(input);
	});

	it("accepts undefined lockfile", () => {
		const input = { name: "npm", version: "10.0.0", lockfile: undefined };
		const result = Schema.decodeUnknownSync(PackageManagerInfo)(input);
		expect(result.lockfile).toBeUndefined();
	});

	it("rejects invalid package manager name", () => {
		expect(() => Schema.decodeUnknownSync(PackageManagerInfo)({ name: "invalid", version: "1.0.0" })).toThrow();
	});
});
