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
	/** Assets per release id — populated by uploadAsset, read by listReleaseAssets. */
	readonly assets: Map<number, Array<ReleaseAsset>>;
}

const makeTestClient = (state: GitHubReleaseTestState): typeof GitHubRelease.Service => ({
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
		const existing = state.assets.get(releaseId) ?? [];
		existing.push(asset);
		state.assets.set(releaseId, existing);
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

	updateRelease: (releaseId, options) => {
		const release = Array.from(state.releases.values()).find((r) => r.id === releaseId);
		if (!release) {
			return Effect.fail(
				new GitHubReleaseError({
					operation: "updateRelease",
					reason: `No release with id ${releaseId}`,
					retryable: false,
				}),
			);
		}
		const updated: ReleaseData = {
			...release,
			...(options.body !== undefined ? { body: options.body } : {}),
			...(options.name !== undefined ? { name: options.name } : {}),
			...(options.draft !== undefined ? { draft: options.draft } : {}),
			...(options.prerelease !== undefined ? { prerelease: options.prerelease } : {}),
		};
		state.releases.set(updated.tag, updated);
		return Effect.succeed(updated);
	},

	listReleaseAssets: (releaseId) => Effect.succeed(state.assets.get(releaseId) ?? []),
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
			assets: new Map(),
		};
		return { state, layer: Layer.succeed(GitHubReleaseTag, makeTestClient(state)) };
	},
} as const;
