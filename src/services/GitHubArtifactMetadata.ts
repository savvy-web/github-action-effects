import type { Effect } from "effect";
import { Context } from "effect";
import type { GitHubArtifactMetadataError } from "../errors/GitHubArtifactMetadataError.js";

/**
 * Input for creating a GitHub Packages artifact-metadata storage record.
 *
 * @public
 */
export interface StorageRecordInput {
	/** Package URL (purl), e.g. `"pkg:npm/@scope/pkg@1.2.3"`. */
	readonly name: string;
	/** Artifact digest. */
	readonly digest: string;
	/** Package version. */
	readonly version: string;
	/** Registry URL, e.g. `"https://npm.pkg.github.com/"`. */
	readonly registryUrl: string;
	/** The artifact's GitHub Packages URL. */
	readonly artifactUrl: string;
	/** Unscoped package / repo name. */
	readonly repo: string;
}

/**
 * Service for GitHub Packages artifact-metadata operations.
 *
 * @public
 */
export class GitHubArtifactMetadata extends Context.Tag("github-action-effects/GitHubArtifactMetadata")<
	GitHubArtifactMetadata,
	{
		/**
		 * Create an artifact-metadata storage record linking an attestation to a
		 * published GitHub Packages artifact. Returns the created record IDs.
		 */
		readonly createStorageRecord: (
			input: StorageRecordInput,
		) => Effect.Effect<ReadonlyArray<number>, GitHubArtifactMetadataError>;
	}
>() {}
