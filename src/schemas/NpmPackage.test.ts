import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { NpmPackageInfo } from "./NpmPackage.js";

describe("NpmPackageInfo", () => {
	it("decodes a valid package info", () => {
		const input = {
			name: "@scope/pkg",
			version: "1.2.3",
			distTags: { latest: "1.2.3", next: "2.0.0-beta.1" },
			integrity: "sha512-abc123",
			tarball: "https://registry.npmjs.org/@scope/pkg/-/pkg-1.2.3.tgz",
		};
		const result = Schema.decodeUnknownSync(NpmPackageInfo)(input);
		expect(result).toEqual(input);
	});

	it("accepts undefined optional fields", () => {
		const input = {
			name: "simple-pkg",
			version: "0.1.0",
			distTags: {},
			integrity: undefined,
			tarball: undefined,
		};
		const result = Schema.decodeUnknownSync(NpmPackageInfo)(input);
		expect(result.integrity).toBeUndefined();
		expect(result.tarball).toBeUndefined();
	});

	it("rejects missing name", () => {
		expect(() =>
			Schema.decodeUnknownSync(NpmPackageInfo)({
				version: "1.0.0",
				distTags: {},
			}),
		).toThrow();
	});
});
