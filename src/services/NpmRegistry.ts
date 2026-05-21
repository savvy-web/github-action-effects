import type { Effect, Option } from "effect";
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
		/**
		 * Fetch package metadata.
		 *
		 * @param pkg - Package name.
		 * @param version - Optional specific version; omitted reads the
		 *   distribution's `latest`.
		 * @param options - Optional overrides. When `registry` is supplied
		 *   the underlying `npm view` invocation appends
		 *   `--registry <registry>`; otherwise npm's default registry is used.
		 */
		readonly getPackageInfo: (
			pkg: string,
			version?: string,
			options?: { readonly registry?: string },
		) => Effect.Effect<NpmPackageInfo, NpmRegistryError>;
		/**
		 * List published versions.
		 *
		 * @param pkg - Package name.
		 * @param options - Optional overrides. When `registry` is supplied
		 *   the underlying `npm view` invocation appends
		 *   `--registry <registry>`; otherwise npm's default registry is used.
		 */
		readonly getVersions: (
			pkg: string,
			options?: { readonly registry?: string },
		) => Effect.Effect<Array<string>, NpmRegistryError>;
		/**
		 * Probe a specific registry for the published integrity hash of a
		 * package version. Returns `Option.some(integrity)` when the version
		 * is on that registry with a `dist.integrity` value, and
		 * `Option.none()` when the version is not published there (collapses
		 * an `npm view` E404 into "not present" rather than an error, since
		 * a missing version is a normal branch of the publish flow). Other
		 * failures (network, auth, malformed JSON) propagate as
		 * `NpmRegistryError`.
		 *
		 * @param pkg - Package name.
		 * @param version - Specific version to probe.
		 * @param options - Required registry override; the probe always
		 *   targets a specific registry rather than npm's default.
		 */
		readonly getPublishedIntegrity: (
			pkg: string,
			version: string,
			options: { readonly registry: string },
		) => Effect.Effect<Option.Option<string>, NpmRegistryError>;
	}
>() {}
