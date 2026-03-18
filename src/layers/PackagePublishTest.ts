import { Effect, Layer } from "effect";
import type { PackResult, PackagePublish, RegistryTarget } from "../services/PackagePublish.js";
import { PackagePublish as PackagePublishTag } from "../services/PackagePublish.js";

/**
 * Test state for PackagePublish.
 *
 * @public
 */
export interface PackagePublishTestState {
	readonly packResult: PackResult;
	readonly integrityMatch: boolean;
	readonly setupAuthCalls: Array<{ registry: string; token: string }>;
	readonly packCalls: Array<{ packageDir: string }>;
	readonly publishCalls: Array<{ packageDir: string; options?: Record<string, unknown> }>;
	readonly verifyIntegrityCalls: Array<{ packageName: string; version: string; expectedDigest: string }>;
	readonly publishToRegistriesCalls: Array<{ packageDir: string; registries: Array<RegistryTarget> }>;
}

const defaultPackResult: PackResult = { tarball: "pkg-1.0.0.tgz", digest: "sha256-abc123" };

const makeTestClient = (state: PackagePublishTestState): typeof PackagePublish.Service => ({
	setupAuth: (registry, token) =>
		Effect.sync(() => {
			state.setupAuthCalls.push({ registry, token });
		}).pipe(Effect.withSpan("PackagePublish.setupAuth")),

	pack: (packageDir) =>
		Effect.sync(() => {
			state.packCalls.push({ packageDir });
			return state.packResult;
		}).pipe(Effect.withSpan("PackagePublish.pack")),

	publish: (packageDir, options) =>
		Effect.sync(() => {
			state.publishCalls.push(options ? { packageDir, options: options as Record<string, unknown> } : { packageDir });
		}).pipe(Effect.withSpan("PackagePublish.publish")),

	verifyIntegrity: (packageName, version, expectedDigest) =>
		Effect.sync(() => {
			state.verifyIntegrityCalls.push({ packageName, version, expectedDigest });
			return state.integrityMatch;
		}).pipe(Effect.withSpan("PackagePublish.verifyIntegrity")),

	publishToRegistries: (packageDir, registries) =>
		Effect.sync(() => {
			state.publishToRegistriesCalls.push({ packageDir, registries });
		}).pipe(Effect.withSpan("PackagePublish.publishToRegistries")),
});

const makeState = (
	overrides?: Partial<Pick<PackagePublishTestState, "packResult" | "integrityMatch">>,
): PackagePublishTestState => ({
	packResult: overrides?.packResult ?? defaultPackResult,
	integrityMatch: overrides?.integrityMatch ?? true,
	setupAuthCalls: [],
	packCalls: [],
	publishCalls: [],
	verifyIntegrityCalls: [],
	publishToRegistriesCalls: [],
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
		overrides?: Partial<Pick<PackagePublishTestState, "packResult" | "integrityMatch">>,
	): { state: PackagePublishTestState; layer: Layer.Layer<PackagePublish> } => {
		const state = makeState(overrides);
		return { state, layer: Layer.succeed(PackagePublishTag, makeTestClient(state)) };
	},
} as const;
