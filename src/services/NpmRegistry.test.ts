import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { NpmRegistryTest } from "../layers/NpmRegistryTest.js";
import { NpmRegistry } from "./NpmRegistry.js";

const testState = {
	packages: new Map([
		[
			"effect",
			{
				versions: ["3.0.0", "3.1.0", "3.2.0"],
				latest: "3.2.0",
				distTags: { latest: "3.2.0", next: "4.0.0-alpha.1" },
				integrity: "sha512-abc123",
				tarball: "https://registry.npmjs.org/effect/-/effect-3.2.0.tgz",
			},
		],
	]),
};

describe("NpmRegistry", () => {
	it("getLatestVersion returns latest version", async () => {
		const layer = NpmRegistryTest.layer(testState);
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getLatestVersion("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toBe("3.2.0");
	});

	it("getDistTags returns all dist tags", async () => {
		const layer = NpmRegistryTest.layer(testState);
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getDistTags("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual({ latest: "3.2.0", next: "4.0.0-alpha.1" });
	});

	it("getPackageInfo returns package metadata", async () => {
		const layer = NpmRegistryTest.layer(testState);
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getPackageInfo("effect")),
				Effect.provide(layer),
			),
		);
		expect(result.name).toBe("effect");
		expect(result.version).toBe("3.2.0");
		expect(result.integrity).toBe("sha512-abc123");
	});

	it("getVersions returns all versions", async () => {
		const layer = NpmRegistryTest.layer(testState);
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getVersions("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual(["3.0.0", "3.1.0", "3.2.0"]);
	});

	it("fails for unknown package", async () => {
		const layer = NpmRegistryTest.empty();
		const exit = await Effect.runPromiseExit(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getLatestVersion("nonexistent")),
				Effect.provide(layer),
			),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("error includes package name", async () => {
		const layer = NpmRegistryTest.empty();
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getLatestVersion("missing-pkg")),
				Effect.catchAll((error) => Effect.succeed(error)),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveProperty("pkg", "missing-pkg");
	});
});
