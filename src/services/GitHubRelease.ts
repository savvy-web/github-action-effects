import type { Effect } from "effect";
import { Context } from "effect";
import type { GitHubReleaseError } from "../errors/GitHubReleaseError.js";

/**
 * Data returned from a GitHub release.
 *
 * @public
 */
export interface ReleaseData {
	readonly id: number;
	readonly tag: string;
	readonly name: string;
	readonly body: string;
	readonly draft: boolean;
	readonly prerelease: boolean;
	readonly uploadUrl: string;
}

/**
 * Data returned from an uploaded release asset.
 *
 * @public
 */
export interface ReleaseAsset {
	readonly id: number;
	readonly name: string;
	readonly url: string;
	readonly size: number;
}

/**
 * Service for GitHub Release operations.
 *
 * @public
 */
export class GitHubRelease extends Context.Tag("github-action-effects/GitHubRelease")<
	GitHubRelease,
	{
		/** Create a new GitHub release. */
		readonly create: (options: {
			readonly tag: string;
			readonly name: string;
			readonly body: string;
			readonly draft?: boolean;
			readonly prerelease?: boolean;
			readonly generateReleaseNotes?: boolean;
		}) => Effect.Effect<ReleaseData, GitHubReleaseError>;

		/** Upload an asset to an existing release. */
		readonly uploadAsset: (
			releaseId: number,
			name: string,
			data: Uint8Array | string,
			contentType: string,
		) => Effect.Effect<ReleaseAsset, GitHubReleaseError>;

		/** Get a release by its tag name. */
		readonly getByTag: (tag: string) => Effect.Effect<ReleaseData, GitHubReleaseError>;

		/** List releases, optionally paginated. */
		readonly list: (options?: {
			readonly perPage?: number;
			readonly maxPages?: number;
		}) => Effect.Effect<Array<ReleaseData>, GitHubReleaseError>;

		/** Update an existing release's fields; returns the updated release. */
		readonly updateRelease: (
			releaseId: number,
			options: {
				readonly body?: string;
				readonly name?: string;
				readonly draft?: boolean;
				readonly prerelease?: boolean;
			},
		) => Effect.Effect<ReleaseData, GitHubReleaseError>;

		/** List all assets attached to a release. */
		readonly listReleaseAssets: (releaseId: number) => Effect.Effect<Array<ReleaseAsset>, GitHubReleaseError>;
	}
>() {}
