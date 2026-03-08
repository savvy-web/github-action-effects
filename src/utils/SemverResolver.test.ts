import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { SemverResolver } from "./SemverResolver.js";

describe("SemverResolver", () => {
	it("compares versions", async () => {
		expect(await Effect.runPromise(SemverResolver.compare("1.0.0", "2.0.0"))).toBe(-1);
		expect(await Effect.runPromise(SemverResolver.compare("2.0.0", "1.0.0"))).toBe(1);
		expect(await Effect.runPromise(SemverResolver.compare("1.0.0", "1.0.0"))).toBe(0);
	});

	it("checks satisfies", async () => {
		expect(await Effect.runPromise(SemverResolver.satisfies("1.2.3", "^1.0.0"))).toBe(true);
		expect(await Effect.runPromise(SemverResolver.satisfies("2.0.0", "^1.0.0"))).toBe(false);
	});

	it("finds latest in range", async () => {
		const result = await Effect.runPromise(
			SemverResolver.latestInRange(["1.0.0", "1.2.0", "1.5.0", "2.0.0"], "^1.0.0"),
		);
		expect(result).toBe("1.5.0");
	});

	it("fails when no version satisfies range", async () => {
		const exit = await Effect.runPromiseExit(SemverResolver.latestInRange(["3.0.0"], "^1.0.0"));
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("increments versions", async () => {
		expect(await Effect.runPromise(SemverResolver.increment("1.2.3", "patch"))).toBe("1.2.4");
		expect(await Effect.runPromise(SemverResolver.increment("1.2.3", "minor"))).toBe("1.3.0");
		expect(await Effect.runPromise(SemverResolver.increment("1.2.3", "major"))).toBe("2.0.0");
	});

	it("parses versions", async () => {
		const result = await Effect.runPromise(SemverResolver.parse("1.2.3-beta.1"));
		expect(result).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
			prerelease: "beta.1",
		});
	});

	it("fails on invalid version", async () => {
		const exit = await Effect.runPromiseExit(SemverResolver.parse("not-a-version"));
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("fails compare with invalid semver", async () => {
		const exit = await Effect.runPromiseExit(SemverResolver.compare("invalid", "1.0.0"));
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("fails increment with invalid version", async () => {
		const exit = await Effect.runPromiseExit(SemverResolver.increment("not-valid", "patch"));
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("parses version without prerelease or build", async () => {
		const result = await Effect.runPromise(SemverResolver.parse("2.0.0"));
		expect(result).toEqual({ major: 2, minor: 0, patch: 0 });
		expect(result).not.toHaveProperty("prerelease");
		expect(result).not.toHaveProperty("build");
	});

	it("parses version with build metadata", async () => {
		const result = await Effect.runPromise(SemverResolver.parse("1.0.0+build.123"));
		expect(result).toEqual({ major: 1, minor: 0, patch: 0, build: "build.123" });
	});

	it("increments prerelease", async () => {
		const result = await Effect.runPromise(SemverResolver.increment("1.0.0", "prerelease"));
		expect(result).toBe("1.0.1-0");
	});

	it("satisfies returns false for non-matching range", async () => {
		const result = await Effect.runPromise(SemverResolver.satisfies("3.0.0", "~1.2.0"));
		expect(result).toBe(false);
	});

	it("latestInRange fails with descriptive error", async () => {
		const exit = await Effect.runPromiseExit(SemverResolver.latestInRange(["1.0.0", "2.0.0"], ">=5.0.0"));
		expect(Exit.isFailure(exit)).toBe(true);
	});
});
