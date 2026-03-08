import { Effect, Layer } from "effect";
import { NpmRegistryError } from "../errors/NpmRegistryError.js";
import type { NpmRegistry } from "../services/NpmRegistry.js";
import { NpmRegistry as NpmRegistryTag } from "../services/NpmRegistry.js";

/**
 * Test state for NpmRegistry.
 *
 * @public
 */
export interface NpmRegistryTestState {
	readonly packages: Map<
		string,
		{
			versions: string[];
			latest: string;
			distTags: Record<string, string>;
			integrity?: string;
			tarball?: string;
		}
	>;
}

interface PackageEntry {
	versions: string[];
	latest: string;
	distTags: Record<string, string>;
	integrity?: string;
	tarball?: string;
}

const getEntry = (
	state: NpmRegistryTestState,
	pkg: string,
	operation: "view" | "search" | "versions",
): Effect.Effect<PackageEntry, NpmRegistryError> => {
	const entry = state.packages.get(pkg);
	if (entry === undefined) {
		return Effect.fail(
			new NpmRegistryError({
				pkg,
				operation,
				reason: `Package "${pkg}" not found in test state`,
			}),
		);
	}
	return Effect.succeed(entry);
};

const makeTestClient = (state: NpmRegistryTestState): NpmRegistry => ({
	getLatestVersion: (pkg: string) => getEntry(state, pkg, "view").pipe(Effect.map((entry) => entry.latest)),

	getDistTags: (pkg: string) => getEntry(state, pkg, "view").pipe(Effect.map((entry) => entry.distTags)),

	getPackageInfo: (pkg: string, version?: string) =>
		getEntry(state, pkg, "view").pipe(
			Effect.map((entry) => ({
				name: pkg,
				version: version ?? entry.latest,
				distTags: entry.distTags,
				integrity: entry.integrity,
				tarball: entry.tarball,
			})),
		),

	getVersions: (pkg: string) => getEntry(state, pkg, "versions").pipe(Effect.map((entry) => entry.versions)),
});

/**
 * Test implementation for NpmRegistry.
 *
 * @public
 */
export const NpmRegistryTest = {
	layer: (state: NpmRegistryTestState): Layer.Layer<NpmRegistry> =>
		Layer.succeed(NpmRegistryTag, makeTestClient(state)),

	empty: (): Layer.Layer<NpmRegistry> => Layer.succeed(NpmRegistryTag, makeTestClient({ packages: new Map() })),
} as const;
