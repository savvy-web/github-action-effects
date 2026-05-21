import { Effect, Layer } from "effect";
import type { GitHubArtifactMetadata, StorageRecordInput } from "../services/GitHubArtifactMetadata.js";
import { GitHubArtifactMetadata as GitHubArtifactMetadataTag } from "../services/GitHubArtifactMetadata.js";

/**
 * Test state for `GitHubArtifactMetadata`.
 *
 * @public
 */
export interface GitHubArtifactMetadataTestState {
	/** Recorded `createStorageRecord` calls. */
	readonly calls: Array<StorageRecordInput>;
	/** Record IDs `createStorageRecord` returns. */
	readonly recordIds: ReadonlyArray<number>;
}

const makeTestClient = (state: GitHubArtifactMetadataTestState): typeof GitHubArtifactMetadata.Service => ({
	createStorageRecord: (input) => {
		state.calls.push(input);
		return Effect.succeed(state.recordIds);
	},
});

/**
 * Test implementation for `GitHubArtifactMetadata`.
 *
 * @public
 */
export const GitHubArtifactMetadataTest = {
	/** Create a test layer with pre-configured state. */
	layer: (state: GitHubArtifactMetadataTestState): Layer.Layer<GitHubArtifactMetadata> =>
		Layer.succeed(GitHubArtifactMetadataTag, makeTestClient(state)),

	/** Create a test layer with empty state. Returns both state and layer for assertions. */
	empty: (): { state: GitHubArtifactMetadataTestState; layer: Layer.Layer<GitHubArtifactMetadata> } => {
		const state: GitHubArtifactMetadataTestState = { calls: [], recordIds: [1] };
		return { state, layer: Layer.succeed(GitHubArtifactMetadataTag, makeTestClient(state)) };
	},
} as const;
