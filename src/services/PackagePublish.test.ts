import { Effect, Exit } from "effect";
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

	it("pack returns tarballPath, digest, and pack metadata", async () => {
		const { state, layer } = PackagePublishTest.layer({
			packResult: {
				tarballPath: "/path/to/pkg/my-pkg-2.0.0.tgz",
				digest: "sha512-def456",
				sha256Hex: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1",
				name: "my-pkg",
				version: "2.0.0",
				packedSize: 1234,
				unpackedSize: 5678,
				fileCount: 9,
			},
		});
		const result = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.pack("/path/to/pkg")),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual({
			tarballPath: "/path/to/pkg/my-pkg-2.0.0.tgz",
			digest: "sha512-def456",
			sha256Hex: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1",
			name: "my-pkg",
			version: "2.0.0",
			packedSize: 1234,
			unpackedSize: 5678,
			fileCount: 9,
		});
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

	it("publishIdempotent publishes when the version is absent", async () => {
		const { state, layer } = PackagePublishTest.layer({ publishedVersions: [] });
		const result = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) =>
					svc.publishIdempotent({
						packageDir: "/pkg",
						packageName: "my-pkg",
						version: "1.0.0",
						digest: "sha512-abc",
					}),
				),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual({ status: "published", packageName: "my-pkg", version: "1.0.0" });
		expect(state.publishIdempotentCalls).toHaveLength(1);
	});

	it("publishIdempotent skips when an identical version is already published", async () => {
		const { layer } = PackagePublishTest.layer({ publishedVersions: ["1.0.0"], integrityMatch: true });
		const result = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) =>
					svc.publishIdempotent({
						packageDir: "/pkg",
						packageName: "my-pkg",
						version: "1.0.0",
						digest: "sha512-abc",
					}),
				),
				Effect.provide(layer),
			),
		);
		expect(result).toEqual({
			status: "skipped",
			packageName: "my-pkg",
			version: "1.0.0",
			skipReason: "already-published-identical",
		});
	});

	it("publishIdempotent fails on a content mismatch", async () => {
		const { layer } = PackagePublishTest.layer({ publishedVersions: ["1.0.0"], integrityMatch: false });
		const exit = await Effect.runPromiseExit(
			PackagePublish.pipe(
				Effect.flatMap((svc) =>
					svc.publishIdempotent({
						packageDir: "/pkg",
						packageName: "my-pkg",
						version: "1.0.0",
						digest: "sha512-wrong",
					}),
				),
				Effect.provide(layer),
			),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("dryRun returns ok: true by default and records the call", async () => {
		const { state, layer } = PackagePublishTest.empty();
		const result = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.dryRun("/path/to/pkg", { registry: "https://registry.npmjs.org" })),
				Effect.provide(layer),
			),
		);
		expect(result.ok).toBe(true);
		expect(result.output).toBe("dry-run ok");
		expect(state.dryRunCalls).toEqual([
			{ packageDir: "/path/to/pkg", options: { registry: "https://registry.npmjs.org" } },
		]);
	});

	it("dryRun returns ok: false when dryRunOk is false", async () => {
		const { state, layer } = PackagePublishTest.layer({ dryRunOk: false });
		const result = await Effect.runPromise(
			PackagePublish.pipe(
				Effect.flatMap((svc) => svc.dryRun("/path/to/pkg")),
				Effect.provide(layer),
			),
		);
		expect(result.ok).toBe(false);
		expect(result.output).toBe("dry-run failed");
		expect(state.dryRunCalls).toHaveLength(1);
		expect(state.dryRunCalls[0]?.packageDir).toBe("/path/to/pkg");
	});
});
