import { Effect, Layer } from "effect";
import { GitHubReleaseError } from "../errors/GitHubReleaseError.js";
import type { GitHubRelease, ReleaseAsset, ReleaseData } from "../services/GitHubRelease.js";
import { GitHubRelease as GitHubReleaseTag } from "../services/GitHubRelease.js";

/**
 * Test state for GitHubRelease.
 *
 * @public
 */
export interface GitHubReleaseTestState {
	readonly releases: Map<string, ReleaseData>;
	readonly createCalls: Array<{ tag: string; name: string }>;
	readonly uploadCalls: Array<{ releaseId: number; name: string }>;
}

const makeTestClient = (state: GitHubReleaseTestState): GitHubRelease => ({
	create: (options) => {
		state.createCalls.push({ tag: options.tag, name: options.name });
		const release: ReleaseData = {
			id: state.releases.size + 1,
			tag: options.tag,
			name: options.name,
			body: options.body,
			draft: options.draft ?? false,
			prerelease: options.prerelease ?? false,
			uploadUrl: `https://uploads.github.com/releases/${state.releases.size + 1}/assets`,
		};
		state.releases.set(options.tag, release);
		return Effect.succeed(release);
	},

	uploadAsset: (releaseId, name, _data, _contentType) => {
		state.uploadCalls.push({ releaseId, name });
		const asset: ReleaseAsset = {
			id: 100 + state.uploadCalls.length,
			name,
			url: `https://example.com/${name}`,
			size: 1024,
		};
		return Effect.succeed(asset);
	},

	getByTag: (tag) => {
		const release = state.releases.get(tag);
		if (!release) {
			return Effect.fail(
				new GitHubReleaseError({
					operation: "getByTag",
					tag,
					reason: `No release for tag "${tag}"`,
					retryable: false,
				}),
			);
		}
		return Effect.succeed(release);
	},

	list: () => Effect.succeed(Array.from(state.releases.values())),
});

/**
 * Test implementation for GitHubRelease.
 *
 * @public
 */
export const GitHubReleaseTest = {
	/** Create test layer with pre-configured state. */
	layer: (state: GitHubReleaseTestState): Layer.Layer<GitHubRelease> =>
		Layer.succeed(GitHubReleaseTag, makeTestClient(state)),

	/** Create test layer with empty state. Returns both state and layer for assertions. */
	empty: (): { state: GitHubReleaseTestState; layer: Layer.Layer<GitHubRelease> } => {
		const state: GitHubReleaseTestState = {
			releases: new Map(),
			createCalls: [],
			uploadCalls: [],
		};
		return { state, layer: Layer.succeed(GitHubReleaseTag, makeTestClient(state)) };
	},
} as const;
