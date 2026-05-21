import type { Redacted } from "effect";
import { Effect, Layer } from "effect";
import { PackagePublishError } from "../errors/PackagePublishError.js";
import type {
	DryRunResult,
	IdempotentPublishInput,
	IdempotentPublishResult,
	PackResult,
	PackagePublish,
	RegistryTarget,
} from "../services/PackagePublish.js";
import { PackagePublish as PackagePublishTag } from "../services/PackagePublish.js";

/**
 * Test state for PackagePublish.
 *
 * @public
 */
export interface PackagePublishTestState {
	readonly packResult: PackResult;
	readonly integrityMatch: boolean;
	readonly publishedVersions: ReadonlyArray<string>;
	readonly dryRunOk: boolean;
	readonly setupAuthCalls: Array<{ registry: string; token: Redacted.Redacted<string> }>;
	readonly packCalls: Array<{ packageDir: string }>;
	readonly publishCalls: Array<{ packageDir: string; options?: Record<string, unknown> }>;
	readonly publishTarballCalls: Array<{ tarballPath: string; options: Record<string, unknown> }>;
	readonly verifyIntegrityCalls: Array<{ packageName: string; version: string; expectedDigest: string }>;
	readonly publishToRegistriesCalls: Array<{ packageDir: string; registries: Array<RegistryTarget> }>;
	readonly publishIdempotentCalls: Array<IdempotentPublishInput>;
	readonly dryRunCalls: Array<{ packageDir: string; options?: Record<string, unknown> }>;
}

const defaultPackResult: PackResult = {
	tarballPath: "/tmp/pkg-1.0.0.tgz",
	digest: "sha512-AAAA",
	sha256Hex: "0000000000000000000000000000000000000000000000000000000000000000",
	name: "pkg",
	version: "1.0.0",
	packedSize: 0,
	unpackedSize: 0,
	fileCount: 0,
};

const makeTestClient = (state: PackagePublishTestState): typeof PackagePublish.Service => ({
	setupAuth: (registry, token) =>
		Effect.sync(() => {
			state.setupAuthCalls.push({ registry, token });
		}),

	pack: (packageDir) =>
		Effect.sync(() => {
			state.packCalls.push({ packageDir });
			return state.packResult;
		}),

	publish: (packageDir, options) =>
		Effect.sync(() => {
			state.publishCalls.push(options ? { packageDir, options: options as Record<string, unknown> } : { packageDir });
		}),

	publishTarball: (tarballPath, options) =>
		Effect.sync(() => {
			state.publishTarballCalls.push({ tarballPath, options: options as Record<string, unknown> });
		}),

	verifyIntegrity: (packageName, version, expectedDigest) =>
		Effect.sync(() => {
			state.verifyIntegrityCalls.push({ packageName, version, expectedDigest });
			return state.integrityMatch;
		}),

	publishToRegistries: (packageDir, registries) =>
		Effect.sync(() => {
			state.publishToRegistriesCalls.push({ packageDir, registries });
		}),

	publishIdempotent: (input) =>
		Effect.suspend((): Effect.Effect<IdempotentPublishResult, PackagePublishError> => {
			state.publishIdempotentCalls.push(input);
			if (!state.publishedVersions.includes(input.version)) {
				return Effect.succeed({
					status: "published" as const,
					packageName: input.packageName,
					version: input.version,
				});
			}
			if (state.integrityMatch) {
				return Effect.succeed({
					status: "skipped" as const,
					packageName: input.packageName,
					version: input.version,
					skipReason: "already-published-identical" as const,
				});
			}
			return Effect.fail(
				new PackagePublishError({
					operation: "publishIdempotent",
					pkg: input.packageName,
					reason: "content mismatch",
				}),
			);
		}),

	dryRun: (packageDir, options) =>
		Effect.sync((): DryRunResult => {
			state.dryRunCalls.push(options ? { packageDir, options: options as Record<string, unknown> } : { packageDir });
			return state.dryRunOk ? { ok: true, output: "dry-run ok" } : { ok: false, output: "dry-run failed" };
		}),
});

const makeState = (
	overrides?: Partial<
		Pick<PackagePublishTestState, "packResult" | "integrityMatch" | "publishedVersions" | "dryRunOk">
	>,
): PackagePublishTestState => ({
	packResult: overrides?.packResult ?? defaultPackResult,
	integrityMatch: overrides?.integrityMatch ?? true,
	publishedVersions: overrides?.publishedVersions ?? [],
	dryRunOk: overrides?.dryRunOk ?? true,
	setupAuthCalls: [],
	packCalls: [],
	publishCalls: [],
	publishTarballCalls: [],
	verifyIntegrityCalls: [],
	publishToRegistriesCalls: [],
	publishIdempotentCalls: [],
	dryRunCalls: [],
});

/**
 * Test implementation for PackagePublish.
 *
 * @public
 */
export const PackagePublishTest = {
	/** Create a test layer with default state. */
	empty: (): { state: PackagePublishTestState; layer: Layer.Layer<PackagePublish> } => {
		const state = makeState();
		return { state, layer: Layer.succeed(PackagePublishTag, makeTestClient(state)) };
	},

	/** Create a test layer with custom state overrides. */
	layer: (
		overrides?: Partial<
			Pick<PackagePublishTestState, "packResult" | "integrityMatch" | "publishedVersions" | "dryRunOk">
		>,
	): { state: PackagePublishTestState; layer: Layer.Layer<PackagePublish> } => {
		const state = makeState(overrides);
		return { state, layer: Layer.succeed(PackagePublishTag, makeTestClient(state)) };
	},
} as const;
