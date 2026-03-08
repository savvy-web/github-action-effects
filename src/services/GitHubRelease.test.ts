import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubReleaseTest } from "../layers/GitHubReleaseTest.js";
import { GitHubRelease } from "./GitHubRelease.js";

describe("GitHubRelease", () => {
	it("creates a release", async () => {
		const { state, layer } = GitHubReleaseTest.empty();
		const result = await Effect.runPromise(
			GitHubRelease.pipe(
				Effect.flatMap((svc) => svc.create({ tag: "v1.0.0", name: "Release 1.0.0", body: "Changes" })),
				Effect.provide(layer),
			),
		);
		expect(result.tag).toBe("v1.0.0");
		expect(result.id).toBe(1);
		expect(state.createCalls).toHaveLength(1);
	});

	it("uploads an asset", async () => {
		const { state, layer } = GitHubReleaseTest.empty();
		const result = await Effect.runPromise(
			GitHubRelease.pipe(
				Effect.flatMap((svc) => svc.uploadAsset(1, "dist.tar.gz", "data", "application/gzip")),
				Effect.provide(layer),
			),
		);
		expect(result.name).toBe("dist.tar.gz");
		expect(state.uploadCalls).toHaveLength(1);
	});

	it("gets release by tag", async () => {
		const { layer } = GitHubReleaseTest.empty();
		const result = await Effect.runPromise(
			GitHubRelease.pipe(
				Effect.flatMap((svc) =>
					Effect.flatMap(svc.create({ tag: "v2.0.0", name: "Release 2.0.0", body: "Notes" }), () =>
						svc.getByTag("v2.0.0"),
					),
				),
				Effect.provide(layer),
			),
		);
		expect(result.tag).toBe("v2.0.0");
	});

	it("fails for unknown tag", async () => {
		const { layer } = GitHubReleaseTest.empty();
		const exit = await Effect.runPromiseExit(
			GitHubRelease.pipe(
				Effect.flatMap((svc) => svc.getByTag("v99.0.0")),
				Effect.provide(layer),
			),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("lists releases", async () => {
		const { layer } = GitHubReleaseTest.empty();
		const result = await Effect.runPromise(
			GitHubRelease.pipe(
				Effect.flatMap((svc) =>
					Effect.flatMap(svc.create({ tag: "v1.0.0", name: "R1", body: "" }), () =>
						Effect.flatMap(svc.create({ tag: "v2.0.0", name: "R2", body: "" }), () => svc.list()),
					),
				),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveLength(2);
	});

	it("reports errors with operation and tag", async () => {
		const { layer } = GitHubReleaseTest.empty();
		const error = await Effect.runPromise(
			GitHubRelease.pipe(
				Effect.flatMap((svc) => svc.getByTag("missing")),
				Effect.catchAll((e) => Effect.succeed(e)),
				Effect.provide(layer),
			),
		);
		expect(error).toHaveProperty("operation", "getByTag");
		expect(error).toHaveProperty("tag", "missing");
	});
});
