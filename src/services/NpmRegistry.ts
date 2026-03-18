import type { Effect } from "effect";
import { Context } from "effect";
import type { NpmRegistryError } from "../errors/NpmRegistryError.js";
import type { NpmPackageInfo } from "../schemas/NpmPackage.js";

/**
 * Service for npm registry queries.
 *
 * @public
 */
export class NpmRegistry extends Context.Tag("github-action-effects/NpmRegistry")<
	NpmRegistry,
	{
		readonly getLatestVersion: (pkg: string) => Effect.Effect<string, NpmRegistryError>;
		readonly getDistTags: (pkg: string) => Effect.Effect<Record<string, string>, NpmRegistryError>;
		readonly getPackageInfo: (pkg: string, version?: string) => Effect.Effect<NpmPackageInfo, NpmRegistryError>;
		readonly getVersions: (pkg: string) => Effect.Effect<Array<string>, NpmRegistryError>;
	}
>() {}
