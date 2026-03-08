import type { Effect } from "effect";
import { Context } from "effect";
import type { PackagePublishError } from "../errors/PackagePublishError.js";

/**
 * Result of packing a package.
 *
 * @public
 */
export interface PackResult {
	readonly tarball: string;
	readonly digest: string;
}

/**
 * Target registry for publishing.
 *
 * @public
 */
export interface RegistryTarget {
	readonly registry: string;
	readonly token: string;
	readonly tag?: string;
	readonly access?: "public" | "restricted";
}

/**
 * Service interface for npm package publishing workflow.
 *
 * @public
 */
export interface PackagePublish {
	/** Configure npm authentication for a registry. */
	readonly setupAuth: (registry: string, token: string) => Effect.Effect<void, PackagePublishError>;

	/** Pack a package directory into a tarball and compute its digest. */
	readonly pack: (packageDir: string) => Effect.Effect<PackResult, PackagePublishError>;

	/** Publish a package to a registry. */
	readonly publish: (
		packageDir: string,
		options?: {
			readonly registry?: string;
			readonly tag?: string;
			readonly access?: "public" | "restricted";
			readonly provenance?: boolean;
		},
	) => Effect.Effect<void, PackagePublishError>;

	/** Verify a published package's integrity hash matches the expected digest. */
	readonly verifyIntegrity: (
		packageName: string,
		version: string,
		expectedDigest: string,
	) => Effect.Effect<boolean, PackagePublishError>;

	/** Publish a package to multiple registries in sequence. */
	readonly publishToRegistries: (
		packageDir: string,
		registries: Array<RegistryTarget>,
	) => Effect.Effect<void, PackagePublishError>;
}

/**
 * PackagePublish tag for dependency injection.
 *
 * @public
 */
export const PackagePublish = Context.GenericTag<PackagePublish>("PackagePublish");
