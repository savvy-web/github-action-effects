import type { Effect } from "effect";
import { Context } from "effect";
import type { NpmRegistryError } from "../errors/NpmRegistryError.js";
import type { NpmPackageInfo } from "../schemas/NpmPackage.js";

/**
 * Service interface for npm registry queries.
 *
 * @public
 */
export interface NpmRegistry {
	readonly getLatestVersion: (pkg: string) => Effect.Effect<string, NpmRegistryError>;
	readonly getDistTags: (pkg: string) => Effect.Effect<Record<string, string>, NpmRegistryError>;
	readonly getPackageInfo: (pkg: string, version?: string) => Effect.Effect<NpmPackageInfo, NpmRegistryError>;
	readonly getVersions: (pkg: string) => Effect.Effect<Array<string>, NpmRegistryError>;
}

/**
 * NpmRegistry tag for dependency injection.
 *
 * @public
 */
export const NpmRegistry = Context.GenericTag<NpmRegistry>("NpmRegistry");
