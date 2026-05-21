import type { Effect } from "effect";
import { Context } from "effect";
import type { PackagePublishError } from "../errors/PackagePublishError.js";

/**
 * Result of packing a package directory into a tarball.
 *
 * @remarks
 * `digest` is in the integrity format `sha512-<base64>` — the same shape
 * the registry stores as `dist.integrity` — so a direct string compare
 * against the value returned by {@link NpmRegistry.getPublishedIntegrity}
 * tells the orchestrator whether the local tarball matches the
 * already-published one.
 *
 * @public
 */
export interface PackResult {
	/** Absolute path to the packed tarball on disk. */
	readonly tarballPath: string;
	/**
	 * Integrity digest of the tarball, in npm's `dist.integrity` format
	 * (`sha512-<base64>`). Sourced from `npm pack --json`'s emitted
	 * `integrity` field rather than recomputed locally so the value
	 * matches byte-for-byte what the registry would store.
	 */
	readonly digest: string;
	/**
	 * SHA-256 of the tarball, as a lowercase hex string (no `sha256:`
	 * prefix). Computed locally from {@link tarballPath}. This is the
	 * digest format the GitHub artifact-metadata and attestation APIs
	 * accept as the subject. It is NOT interchangeable with {@link digest}:
	 * different algorithm, different encoding.
	 */
	readonly sha256Hex: string;
	/** Package name as reported by `npm pack --json`. */
	readonly name: string;
	/** Package version as reported by `npm pack --json`. */
	readonly version: string;
	/** Tarball size on disk, in bytes (`size` from `npm pack --json`). */
	readonly packedSize: number;
	/** Unpacked package size in bytes (`unpackedSize` from `npm pack --json`). */
	readonly unpackedSize: number;
	/** File count in the tarball (`entryCount` from `npm pack --json`). */
	readonly fileCount: number;
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
	/**
	 * Package manager whose bundled `npm` executor runs the publish. Matches the
	 * `packageManager` option on {@link PackagePublish.publish} — non-`npm`
	 * dispatchers (`pnpm dlx npm`, `yarn npm`, `bun x npm`) fetch a fresh npm so
	 * the OIDC trusted-publisher exchange works on runners pinned to an older
	 * bundled npm. Defaults to bare `npm`.
	 */
	readonly packageManager?: "npm" | "pnpm" | "yarn" | "bun";
}

/**
 * Input for {@link PackagePublish.publishIdempotent}.
 *
 * @public
 */
export interface IdempotentPublishInput {
	/** Directory of the package to publish. */
	readonly packageDir: string;
	/** Package name, used for the registry version lookup. */
	readonly packageName: string;
	/** Version being published. */
	readonly version: string;
	/**
	 * Content digest of the package tarball, from a prior {@link PackagePublish.pack}
	 * call. Compared against the registry's published integrity hash.
	 */
	readonly digest: string;
	/** Publish options forwarded to {@link PackagePublish.publish}. */
	readonly options?: {
		readonly registry?: string;
		readonly tag?: string;
		readonly access?: "public" | "restricted";
		readonly provenance?: boolean;
		readonly packageManager?: "npm" | "pnpm" | "yarn" | "bun";
	};
}

/**
 * Outcome of {@link PackagePublish.publishIdempotent}.
 *
 * @public
 */
export interface IdempotentPublishResult {
	/** `"published"` when the package was published; `"skipped"` when an identical version already existed. */
	readonly status: "published" | "skipped";
	readonly packageName: string;
	readonly version: string;
	/** Set only when `status` is `"skipped"`. */
	readonly skipReason?: "already-published-identical";
}

/**
 * Outcome of a `npm publish --dry-run`.
 *
 * @public
 */
export interface DryRunResult {
	/** `true` when `npm publish --dry-run` exited cleanly — the package would publish. */
	readonly ok: boolean;
	/** Packed tarball size in bytes, when npm reported it. */
	readonly packedSize?: number;
	/** Unpacked size in bytes, when npm reported it. */
	readonly unpackedSize?: number;
	/** File count in the tarball, when npm reported it. */
	readonly fileCount?: number;
	/** Raw npm output (stdout on success, stderr/​reason on failure) — for diagnostics. */
	readonly output: string;
}

/**
 * Service for npm package publishing workflow.
 *
 * @public
 */
export class PackagePublish extends Context.Tag("github-action-effects/PackagePublish")<
	PackagePublish,
	{
		/** Configure npm authentication for a registry. */
		readonly setupAuth: (registry: string, token: string) => Effect.Effect<void, PackagePublishError>;

		/** Pack a package directory into a tarball and capture its size, file count, and integrity digest. */
		readonly pack: (packageDir: string) => Effect.Effect<PackResult, PackagePublishError>;

		/** Publish a package to a registry. */
		readonly publish: (
			packageDir: string,
			options?: {
				readonly registry?: string;
				readonly tag?: string;
				readonly access?: "public" | "restricted";
				readonly provenance?: boolean;
				/**
				 * Active package manager — controls how `npm publish` is
				 * invoked. `"npm"` runs the runner's bundled `npm`, `"pnpm"`
				 * runs `pnpm dlx npm`, `"yarn"` runs `yarn npm`, `"bun"`
				 * runs `bun x npm`. The non-npm dispatchers fetch a fresh
				 * `npm` rather than using the runner's bundled version,
				 * which is critical for OIDC trusted publishing (requires
				 * npm ≥ 11.5.1; GitHub-hosted runners on Node 24 ship npm
				 * 10.x). Default `"npm"` preserves prior behaviour.
				 */
				readonly packageManager?: "npm" | "pnpm" | "yarn" | "bun";
			},
		) => Effect.Effect<void, PackagePublishError>;

		/**
		 * Publish a previously-packed tarball to a registry.
		 *
		 * @remarks
		 * Unlike {@link publish}, which takes a directory and lets `npm`
		 * pack it implicitly, `publishTarball` accepts the absolute path
		 * to a `.tgz` from a prior {@link pack} call and uploads its
		 * bytes directly — no second pack happens. Two targets pointing
		 * at the same tarball upload byte-identical content, which is
		 * what makes the integrity-compare branch of a recovery run
		 * meaningful: the digest the caller compared against the
		 * registry is also the digest of what gets uploaded.
		 *
		 * `registry` is required because the whole point of this method
		 * is "upload this specific tarball to that specific registry";
		 * an absent registry would invite a silent default-registry
		 * dispatch, which is exactly the bug this method exists to fix.
		 */
		readonly publishTarball: (
			tarballPath: string,
			options: {
				readonly registry: string;
				readonly access?: "public" | "restricted";
				readonly provenance?: boolean;
				readonly tag?: string;
				readonly packageManager?: "npm" | "pnpm" | "yarn" | "bun";
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

		/**
		 * Publish a package only when its exact version is not already on the
		 * registry.
		 *
		 * @remarks
		 * Skips when an identical version is already published (the registry
		 * integrity hash matches `input.digest`); fails with a content-mismatch
		 * {@link PackagePublishError} when the published version differs.
		 * Authentication is the caller's responsibility, as for {@link publish}.
		 *
		 * Assumes the package name already exists on the registry: the version
		 * lookup errors for a name that has never been published, so a brand-new
		 * package's first publish must be routed through a separate path by the
		 * caller, not through `publishIdempotent`.
		 *
		 * @deprecated The fused probe-then-publish dispatch hardcoded the
		 *   wrong registry (the npm default) and could not recover from a
		 *   partial publish across multiple registries. New callers should
		 *   compose {@link pack}, {@link NpmRegistry.getPublishedIntegrity},
		 *   and {@link publishTarball} themselves. This method is kept for
		 *   the migration window; removal lands in a follow-up.
		 */
		readonly publishIdempotent: (
			input: IdempotentPublishInput,
		) => Effect.Effect<IdempotentPublishResult, PackagePublishError>;

		/**
		 * Simulate publishing a package via `npm publish --dry-run` — confirms the
		 * registry would accept it (auth, reachability, version conflict) without
		 * publishing anything.
		 *
		 * @remarks
		 * A non-zero `npm` exit (bad auth, unreachable registry, version conflict)
		 * is reported as `ok: false` in the result, not as an error — a failed
		 * dry-run is a valid outcome. The error channel is reserved for a
		 * structural failure (npm could not be spawned, or its `--json` output
		 * could not be parsed).
		 */
		readonly dryRun: (
			packageDir: string,
			options?: {
				readonly registry?: string;
				readonly tag?: string;
				readonly access?: "public" | "restricted";
				readonly provenance?: boolean;
			},
		) => Effect.Effect<DryRunResult, PackagePublishError>;
	}
>() {}
