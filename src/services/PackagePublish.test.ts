import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { PackagePublishTest } from "../layers/PackagePublishTest.js";
import { PackagePublish } from "./PackagePublish.js";

describe("PackagePublish", () => {
	it("setupAuth records registry and token", async () => {
		const { state, layer } = PackagePublishTest.empty();
		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.setupAuth("npm.pkg.github.com", "ghp_abc123")),
				Effect.provide(layer),
			),
		);
		expect(state.setupAuthCalls).toEqual([{ registry: "npm.pkg.github.com", token: "ghp_abc123" }]);
	});

	it("pack returns tarball and digest", async () => {
		const { state, layer } = PackagePublishTest.layer({
			packResult: { tarball: "my-pkg-2.0.0.tgz", digest: "sha256-def456" },
		});
		const result = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.pack("/path/to/pkg")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual({ tarball: "my-pkg-2.0.0.tgz", digest: "sha256-def456" });
		expect(state.packCalls).toEqual([{ packageDir: "/path/to/pkg" }]);
	});

	it("publish records options", async () => {
		const { state, layer } = PackagePublishTest.empty();
		const options = { registry: "https://registry.npmjs.org", tag: "latest", access: "public" as const };
		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publish("/path/to/pkg", options)),
				Effect.provide(layer),
			),
		);
		expect(state.publishCalls).toEqual([{ packageDir: "/path/to/pkg", options }]);
	});

	it("verifyIntegrity returns true when match", async () => {
		const { state, layer } = PackagePublishTest.layer({ integrityMatch: true });
		const result = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.verifyIntegrity("my-pkg", "1.0.0", "sha256-abc")),
				Effect.provide(layer),
			),
		);
		expect(result).toBe(true);
		expect(state.verifyIntegrityCalls).toEqual([
			{ packageName: "my-pkg", version: "1.0.0", expectedDigest: "sha256-abc" },
		]);
	});

	it("verifyIntegrity returns false when mismatch", async () => {
		const { state, layer } = PackagePublishTest.layer({ integrityMatch: false });
		const result = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.verifyIntegrity("my-pkg", "1.0.0", "sha256-wrong")),
				Effect.provide(layer),
			),
		);
		expect(result).toBe(false);
		expect(state.verifyIntegrityCalls).toHaveLength(1);
	});

	it("publishToRegistries calls per registry", async () => {
		const { state, layer } = PackagePublishTest.empty();
		const registries = [
			{ registry: "https://registry.npmjs.org", token: "npm_abc" },
			{ registry: "https://npm.pkg.github.com", token: "ghp_def", tag: "next" },
		];
		await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.publishToRegistries("/path/to/pkg", registries)),
				Effect.provide(layer),
			),
		);
		expect(state.publishToRegistriesCalls).toEqual([{ packageDir: "/path/to/pkg", registries }]);
	});
});
