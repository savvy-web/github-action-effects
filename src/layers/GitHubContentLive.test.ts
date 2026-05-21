import { Buffer } from "node:buffer";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubContent } from "../services/GitHubContent.js";
import type { GitHubClientTestState, RestResponse } from "./GitHubClientTest.js";
import { GitHubClientTest } from "./GitHubClientTest.js";
import { GitHubContentLive } from "./GitHubContentLive.js";

const clientState = (rest: Array<[string, RestResponse]>): GitHubClientTestState => ({
	restResponses: new Map(rest),
	paginateResponses: new Map(),
	graphqlResponses: new Map(),
	repo: { owner: "owner", repo: "repo" },
});

describe("GitHubContentLive", () => {
	it("getFile decodes a base64 file to UTF-8 text", async () => {
		const text = JSON.stringify({ version: "1.2.3" });
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const svc = yield* GitHubContent;
				return yield* svc.getFile("pkg/package.json", "base-sha");
			}).pipe(
				Effect.provide(GitHubContentLive),
				Effect.provide(
					GitHubClientTest.layer(
						clientState([
							[
								"repos.getContent",
								{ data: { type: "file", encoding: "base64", content: Buffer.from(text).toString("base64") } },
							],
						]),
					),
				),
			),
		);
		expect(JSON.parse(result)).toEqual({ version: "1.2.3" });
	});

	it("getFile fails when the path resolves to a directory", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const svc = yield* GitHubContent;
				return yield* svc.getFile("some/dir", "base-sha");
			}).pipe(
				Effect.provide(GitHubContentLive),
				Effect.provide(GitHubClientTest.layer(clientState([["repos.getContent", { data: [{ type: "file" }] }]]))),
				Effect.flip,
			),
		);
		expect(result._tag).toBe("GitHubContentError");
		expect(result.operation).toBe("getFile");
		expect(result.path).toBe("some/dir");
	});

	it("getFile fails when the path resolves to a submodule", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const svc = yield* GitHubContent;
				return yield* svc.getFile("some/submodule", "base-sha");
			}).pipe(
				Effect.provide(GitHubContentLive),
				Effect.provide(GitHubClientTest.layer(clientState([["repos.getContent", { data: { type: "submodule" } }]]))),
				Effect.flip,
			),
		);
		expect(result._tag).toBe("GitHubContentError");
		expect(result.operation).toBe("getFile");
		expect(result.path).toBe("some/submodule");
	});

	it("getFile wraps a client error as GitHubContentError", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const svc = yield* GitHubContent;
				return yield* svc.getFile("missing.json", "base-sha");
			}).pipe(Effect.provide(GitHubContentLive), Effect.provide(GitHubClientTest.layer(clientState([]))), Effect.flip),
		);
		expect(result._tag).toBe("GitHubContentError");
		expect(result.operation).toBe("getFile");
		expect(result.path).toBe("missing.json");
	});
});
