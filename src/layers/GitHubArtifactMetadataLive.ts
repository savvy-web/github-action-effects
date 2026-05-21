import { Effect, Layer } from "effect";
import { GitHubArtifactMetadataError } from "../errors/GitHubArtifactMetadataError.js";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubArtifactMetadata } from "../services/GitHubArtifactMetadata.js";
import { GitHubClient } from "../services/GitHubClient.js";

/** Minimal Octokit shape for the low-level `request` method. */
interface OctokitRequest {
	readonly request: (route: string, params: Record<string, unknown>) => Promise<{ data: unknown }>;
}

/** The storage-record endpoint's response shape. */
interface RawStorageResponse {
	readonly storage_records?: ReadonlyArray<{ readonly id: number }>;
}

/**
 * Live `GitHubArtifactMetadata` layer.
 *
 * @public
 */
export const GitHubArtifactMetadataLive: Layer.Layer<GitHubArtifactMetadata, never, GitHubClient> = Layer.effect(
	GitHubArtifactMetadata,
	Effect.map(GitHubClient, (client) => ({
		createStorageRecord: (input) =>
			Effect.flatMap(client.repo, ({ owner }) =>
				client.rest<ReadonlyArray<number>>("orgs.createArtifactStorageRecord", async (octokit) => {
					const ok = octokit as OctokitRequest;
					const response = await ok.request("POST /orgs/{owner}/artifacts/metadata/storage-record", {
						owner,
						name: input.name,
						digest: input.digest,
						version: input.version,
						registry_url: input.registryUrl,
						artifact_url: input.artifactUrl,
						repo: input.repo,
					});
					const data = typeof response.data === "string" ? (JSON.parse(response.data) as unknown) : response.data;
					const ids = (data as RawStorageResponse | null)?.storage_records?.map((r) => r.id) ?? [];
					return { data: ids };
				}),
			).pipe(
				Effect.mapError(
					(error: GitHubClientError) =>
						new GitHubArtifactMetadataError({
							operation: "createStorageRecord",
							reason: error.reason,
							retryable: error.retryable,
						}),
				),
			),
	})),
);
