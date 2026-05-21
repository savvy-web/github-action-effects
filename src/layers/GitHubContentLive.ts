import { Buffer } from "node:buffer";
import { Effect, Layer } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { GitHubContentError } from "../errors/GitHubContentError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { GitHubContent } from "../services/GitHubContent.js";

interface RawContentFile {
	readonly type?: string;
	readonly encoding?: string;
	readonly content?: string;
}

/** Minimal Octokit shape for the repo content API. */
interface OctokitContent {
	readonly rest: {
		readonly repos: {
			readonly getContent: (args: Record<string, unknown>) => Promise<{ data: RawContentFile | unknown[] }>;
		};
	};
}

const asContent = (octokit: unknown): OctokitContent => octokit as OctokitContent;

const mapClientError =
	(path: string) =>
	(error: GitHubClientError): GitHubContentError =>
		new GitHubContentError({ operation: "getFile", path, reason: error.reason });

export const GitHubContentLive: Layer.Layer<GitHubContent, never, GitHubClient> = Layer.effect(
	GitHubContent,
	Effect.map(GitHubClient, (client): typeof GitHubContent.Service => ({
		getFile: (path: string, ref?: string) =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("repos.getContent", (octokit) =>
					asContent(octokit).rest.repos.getContent({
						owner,
						repo,
						path,
						...(ref !== undefined ? { ref } : {}),
					}),
				),
			).pipe(
				Effect.mapError(mapClientError(path)),
				Effect.flatMap((data) => {
					const raw = data as unknown as RawContentFile | unknown[];
					if (Array.isArray(raw)) {
						return Effect.fail(
							new GitHubContentError({
								operation: "getFile",
								path,
								reason: `Path "${path}" is a directory, not a file`,
							}),
						);
					}
					const file = raw as RawContentFile;
					if (file.type !== "file" || file.content === undefined) {
						return Effect.fail(
							new GitHubContentError({
								operation: "getFile",
								path,
								reason: `Path "${path}" did not resolve to a file`,
							}),
						);
					}
					// The contents API returns `encoding: "base64"` for files it can
					// inline. Files over the inline size limit come back with
					// `encoding: "none"` and empty content (the blob API must be used
					// instead). Decoding a non-base64 payload as base64 silently yields
					// garbage, so reject anything we cannot faithfully decode.
					if (file.encoding !== "base64") {
						return Effect.fail(
							new GitHubContentError({
								operation: "getFile",
								path,
								reason: `Path "${path}" returned unsupported content encoding "${file.encoding ?? "undefined"}" (expected "base64")`,
							}),
						);
					}
					return Effect.succeed(Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf-8"));
				}),
			),
	})),
);
