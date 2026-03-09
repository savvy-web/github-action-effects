import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { CommandRunnerError } from "../errors/CommandRunnerError.js";
import { CommandRunner } from "../services/CommandRunner.js";
import { NpmRegistry } from "../services/NpmRegistry.js";
import { NpmRegistryLive } from "./NpmRegistryLive.js";

const makeMockRunner = (responses: Map<string, string>) =>
	Layer.succeed(CommandRunner, {
		exec: () => Effect.die("not used"),
		execCapture: (_command: string, args?: ReadonlyArray<string>) => {
			// Build a key from the args to identify the call
			const key = args?.join(" ") ?? "";
			for (const [pattern, response] of responses) {
				if (key.includes(pattern)) {
					return Effect.succeed({
						exitCode: 0,
						stdout: response,
						stderr: "",
					});
				}
			}
			return Effect.fail(
				new CommandRunnerError({
					command: `npm ${key}`,
					args: args ?? [],
					exitCode: 1,
					stderr: undefined,
					reason: `No mock response for: npm ${key}`,
				}),
			);
		},
		execJson: () => Effect.die("not used"),
		execLines: () => Effect.die("not used"),
	} as CommandRunner);

describe("NpmRegistryLive", () => {
	it("getLatestVersion parses npm view output", async () => {
		const runner = makeMockRunner(new Map([["dist-tags.latest", '"3.2.0"']]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getLatestVersion("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toBe("3.2.0");
	});

	it("getDistTags parses dist-tags object", async () => {
		const runner = makeMockRunner(new Map([["dist-tags --json", JSON.stringify({ latest: "3.2.0", next: "4.0.0" })]]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getDistTags("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual({ latest: "3.2.0", next: "4.0.0" });
	});

	it("getVersions parses versions array", async () => {
		const runner = makeMockRunner(new Map([["versions --json", JSON.stringify(["1.0.0", "2.0.0"])]]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getVersions("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual(["1.0.0", "2.0.0"]);
	});

	it("getVersions handles single version string", async () => {
		const runner = makeMockRunner(new Map([["versions --json", '"1.0.0"']]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getVersions("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual(["1.0.0"]);
	});

	it("getPackageInfo reads flat dot-notation keys from npm view", async () => {
		const npmOutput = JSON.stringify({
			name: "effect",
			version: "3.2.0",
			"dist-tags": { latest: "3.2.0" },
			"dist.integrity": "sha512-abc",
			"dist.tarball": "https://registry.npmjs.org/effect/-/effect-3.2.0.tgz",
		});
		const runner = makeMockRunner(new Map([["name version dist-tags", npmOutput]]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getPackageInfo("effect")),
				Effect.provide(layer),
			),
		);
		expect(result.name).toBe("effect");
		expect(result.version).toBe("3.2.0");
		expect(result.distTags).toEqual({ latest: "3.2.0" });
		expect(result.integrity).toBe("sha512-abc");
		expect(result.tarball).toBe("https://registry.npmjs.org/effect/-/effect-3.2.0.tgz");
	});

	it("getPackageInfo falls back to nested dist object", async () => {
		const npmOutput = JSON.stringify({
			name: "effect",
			version: "3.2.0",
			"dist-tags": { latest: "3.2.0" },
			dist: {
				integrity: "sha512-nested",
				tarball: "https://example.com/effect.tgz",
			},
		});
		const runner = makeMockRunner(new Map([["name version dist-tags", npmOutput]]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getPackageInfo("effect")),
				Effect.provide(layer),
			),
		);
		expect(result.integrity).toBe("sha512-nested");
		expect(result.tarball).toBe("https://example.com/effect.tgz");
	});

	it("getLatestVersion returns non-string data as string via String()", async () => {
		// When npm returns a non-string JSON value (e.g. a number), it should be converted via String()
		const runner = makeMockRunner(new Map([["dist-tags.latest", "42"]]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getLatestVersion("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toBe("42");
	});

	it("getVersions returns empty array for non-array non-string data", async () => {
		// When npm returns an object (not array, not string), getVersions should return []
		const runner = makeMockRunner(new Map([["versions --json", JSON.stringify({ something: true })]]));
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getVersions("effect")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual([]);
	});

	it("maps CommandRunnerError to NpmRegistryError", async () => {
		const runner = makeMockRunner(new Map());
		const layer = NpmRegistryLive.pipe(Layer.provide(runner));
		const result = await Effect.runPromise(
			NpmRegistry.pipe(
				Effect.flatMap((reg) => reg.getLatestVersion("nonexistent")),
				Effect.catchAll((error) => Effect.succeed(error)),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveProperty("_tag", "NpmRegistryError");
		expect(result).toHaveProperty("pkg", "nonexistent");
	});
});
