import { Effect, Layer } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubReleaseError } from "../errors/GitHubReleaseError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import type { ReleaseAsset, ReleaseData } from "../services/GitHubRelease.js";
import { GitHubRelease } from "../services/GitHubRelease.js";

/** Minimal Octokit shape for releases API calls. */
interface OctokitReleases {
	readonly rest: {
		readonly repos: {
			readonly createRelease: (args: Record<string, unknown>) => Promise<{ data: RawRelease }>;
			readonly uploadReleaseAsset: (args: Record<string, unknown>) => Promise<{ data: RawAsset }>;
			readonly getReleaseByTag: (args: Record<string, unknown>) => Promise<{ data: RawRelease }>;
			readonly listReleases: (args: Record<string, unknown>) => Promise<{ data: RawRelease[] }>;
		};
	};
}

interface RawRelease {
	readonly id: number;
	readonly tag_name: string;
	readonly name: string | null;
	readonly body: string | null;
	readonly draft: boolean;
	readonly prerelease: boolean;
	readonly upload_url: string;
}

interface RawAsset {
	readonly id: number;
	readonly name: string;
	readonly browser_download_url: string;
	readonly size: number;
}

const asReleases = (octokit: unknown): OctokitReleases => octokit as OctokitReleases;

const toReleaseData = (raw: RawRelease): ReleaseData => ({
	id: raw.id,
	tag: raw.tag_name,
	name: raw.name ?? "",
	body: raw.body ?? "",
	draft: raw.draft,
	prerelease: raw.prerelease,
	uploadUrl: raw.upload_url,
});

const toReleaseAsset = (raw: RawAsset): ReleaseAsset => ({
	id: raw.id,
	name: raw.name,
	url: raw.browser_download_url,
	size: raw.size,
});

const mapError =
	(operation: "create" | "uploadAsset" | "getByTag" | "list", tag?: string) =>
	(error: GitHubClientError): GitHubReleaseError =>
		new GitHubReleaseError({
			operation,
			...(tag !== undefined ? { tag } : {}),
			reason: error.reason,
			retryable: error.retryable,
		});

export const GitHubReleaseLive: Layer.Layer<GitHubRelease, never, GitHubClient> = Layer.effect(
	GitHubRelease,
	Effect.map(GitHubClient, (client) => ({
		create: (options) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("repos.createRelease", (octokit) =>
					asReleases(octokit).rest.repos.createRelease({
						owner,
						repo,
						tag_name: options.tag,
						name: options.name,
						body: options.body,
						draft: options.draft ?? false,
						prerelease: options.prerelease ?? false,
						generate_release_notes: options.generateReleaseNotes ?? false,
					}),
				),
			).pipe(
				Effect.map((data) => toReleaseData(data as unknown as RawRelease)),
				Effect.mapError(mapError("create", options.tag)),
			),

		uploadAsset: (releaseId, name, data, contentType) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("repos.uploadReleaseAsset", (octokit) =>
					asReleases(octokit).rest.repos.uploadReleaseAsset({
						owner,
						repo,
						release_id: releaseId,
						name,
						data,
						headers: { "content-type": contentType },
					}),
				),
			).pipe(
				Effect.map((data) => toReleaseAsset(data as unknown as RawAsset)),
				Effect.mapError(mapError("uploadAsset")),
			),

		getByTag: (tag) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("repos.getReleaseByTag", (octokit) =>
					asReleases(octokit).rest.repos.getReleaseByTag({
						owner,
						repo,
						tag,
					}),
				),
			).pipe(
				Effect.map((data) => toReleaseData(data as unknown as RawRelease)),
				Effect.mapError(mapError("getByTag", tag)),
			),

		list: (options) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.paginate(
					"repos.listReleases",
					(octokit, page, perPage) =>
						asReleases(octokit).rest.repos.listReleases({
							owner,
							repo,
							page,
							per_page: perPage,
						}),
					{
						...(options?.perPage !== undefined ? { perPage: options.perPage } : {}),
						...(options?.maxPages !== undefined ? { maxPages: options.maxPages } : {}),
					},
				),
			).pipe(
				Effect.map((items) => items.map((item) => toReleaseData(item as unknown as RawRelease))),
				Effect.mapError(mapError("list")),
			),
	})),
);
