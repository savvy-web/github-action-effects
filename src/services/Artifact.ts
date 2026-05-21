import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { ArtifactError } from "../errors/ArtifactError.js";

/**
 * Metadata for a single artifact returned by the backend.
 *
 * @public
 */
export interface ArtifactItem {
	readonly id: number;
	readonly name: string;
	readonly size: number;
	readonly createdAt?: string;
}

/**
 * Options for {@link Artifact.uploadArtifact}.
 *
 * @public
 */
export interface UploadOptions {
	/**
	 * Number of days to retain the artifact (1–90, or the repository max).
	 * Default: the repository retention setting.
	 */
	readonly retentionDays?: number;
	/**
	 * zlib compression level 0–9 passed to POSIX `zip` (`-0`…`-9`). Default 6,
	 * matching `@actions/artifact`. Out-of-range values are clamped. No effect on
	 * Windows, where `Compress-Archive` has no numeric level.
	 */
	readonly compressionLevel?: number;
}

/**
 * Result of a successful {@link Artifact.uploadArtifact}.
 *
 * @public
 */
export interface UploadResult {
	readonly id: number;
	readonly size: number;
}

/**
 * Options for {@link Artifact.downloadArtifact}.
 *
 * @public
 */
export interface DownloadOptions {
	/** Destination directory. Default: a fresh temp dir. */
	readonly path?: string;
}

/**
 * Cross-run / cross-repo lookup parameters.
 *
 * @remarks
 * When supplied, list/get/download/delete route through the public REST API
 * (`GET /repos/{owner}/{repo}/actions/...`) instead of the same-run Twirp
 * backend, and require a `GITHUB_TOKEN` with `actions:read`.
 *
 * @public
 */
export interface FindBy {
	readonly token: string;
	readonly workflowRunId: number;
	readonly repositoryOwner: string;
	readonly repositoryName: string;
}

/**
 * Service for uploading, listing, downloading, and deleting GitHub Actions
 * artifacts (`@actions/artifact` v2 parity).
 *
 * @remarks
 * `ArtifactLive` speaks the GitHub Actions results backend (Twirp
 * `github.actions.results.api.v1.ArtifactService` + Azure Block Blob) using the
 * runner-provided `ACTIONS_RESULTS_URL` / `ACTIONS_RUNTIME_TOKEN`. The artifact
 * backend is an internal GitHub protocol and may change without notice; the
 * implementation mirrors the already-shipped V2 cache layer. `ArtifactTest` is
 * an in-memory namespace layer. No dependency on `@actions/artifact`.
 *
 * **Must run inside an action, not a `run:` step.** The runner injects
 * `ACTIONS_RESULTS_URL` / `ACTIONS_RUNTIME_TOKEN` only into action
 * (`uses:`) execution contexts — they are absent from `run:` shell/script
 * steps. Like `@actions/artifact`, this service therefore works only when the
 * code is invoked from within a bundled JS action (e.g. one produced by
 * `@savvy-web/github-action-builder`), where those vars are present. The same
 * constraint applies to `ActionCache`, which reads the same two vars.
 *
 * @public
 */
export class Artifact extends Context.Tag("github-action-effects/Artifact")<
	Artifact,
	{
		/**
		 * Zip `files` (relative to `rootDirectory`) and upload them as a named
		 * artifact. v2 forbids re-uploading the same name in a run; a conflict is
		 * surfaced as an {@link ArtifactError} (`operation: "upload"`).
		 */
		readonly uploadArtifact: (
			name: string,
			files: ReadonlyArray<string>,
			rootDirectory: string,
			options?: UploadOptions,
		) => Effect.Effect<UploadResult, ArtifactError>;

		/** List artifacts for the current run (or a `findBy` run/repo). */
		readonly listArtifacts: (findBy?: FindBy) => Effect.Effect<ReadonlyArray<ArtifactItem>, ArtifactError>;

		/**
		 * Look up a single artifact by name. Returns `Option.none()` on miss (the
		 * toolkit throws `ArtifactNotFoundError`; `Option` is the idiomatic Effect
		 * modeling and matches `ActionCache.restore`).
		 */
		readonly getArtifact: (name: string, findBy?: FindBy) => Effect.Effect<Option.Option<ArtifactItem>, ArtifactError>;

		/** Download an artifact by id, returning the directory it was unzipped to. */
		readonly downloadArtifact: (
			artifactId: number,
			options?: DownloadOptions,
			findBy?: FindBy,
		) => Effect.Effect<{ readonly downloadPath: string }, ArtifactError>;

		/** Delete an artifact by name, returning the deleted artifact's id. */
		readonly deleteArtifact: (name: string, findBy?: FindBy) => Effect.Effect<{ readonly id: number }, ArtifactError>;
	}
>() {}
