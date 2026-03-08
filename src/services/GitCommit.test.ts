import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { GitCommitError } from "../errors/GitCommitError.js";
import { GitCommitTest } from "../layers/GitCommitTest.js";
import { GitCommit } from "./GitCommit.js";

// -- Shared provide helper --

const provide = <A, E>(state: ReturnType<typeof GitCommitTest.empty>, effect: Effect.Effect<A, E, GitCommit>) =>
	Effect.provide(effect, GitCommitTest.layer(state));

const run = <A, E>(state: ReturnType<typeof GitCommitTest.empty>, effect: Effect.Effect<A, E, GitCommit>) =>
	Effect.runPromise(provide(state, effect));

// -- Service method shorthands --

const createTree = (
	entries: Array<{ path: string; mode: "100644" | "100755" | "040000"; content: string }>,
	baseTree?: string,
) => Effect.flatMap(GitCommit, (svc) => svc.createTree(entries, baseTree));

const createCommit = (message: string, treeSha: string, parentShas: Array<string>) =>
	Effect.flatMap(GitCommit, (svc) => svc.createCommit(message, treeSha, parentShas));

const updateRef = (ref: string, sha: string, force?: boolean) =>
	Effect.flatMap(GitCommit, (svc) => svc.updateRef(ref, sha, force));

const commitFiles = (branch: string, message: string, files: Array<{ path: string; content: string }>) =>
	Effect.flatMap(GitCommit, (svc) => svc.commitFiles(branch, message, files));

describe("GitCommit", () => {
	describe("createTree", () => {
		it("records tree entries and returns a SHA", async () => {
			const state = GitCommitTest.empty();
			const sha = await run(state, createTree([{ path: "file.txt", mode: "100644", content: "hello" }], "base-sha"));
			expect(sha).toBe("tree-sha-1");
			expect(state.trees).toHaveLength(1);
			expect(state.trees[0]?.entries[0]?.path).toBe("file.txt");
			expect(state.trees[0]?.baseTree).toBe("base-sha");
		});

		it("increments SHA counter across calls", async () => {
			const state = GitCommitTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* GitCommit;
				const sha1 = yield* svc.createTree([{ path: "a.txt", mode: "100644", content: "a" }]);
				const sha2 = yield* svc.createTree([{ path: "b.txt", mode: "100644", content: "b" }]);
				return { sha1, sha2 };
			});
			const result = await Effect.runPromise(Effect.provide(program, GitCommitTest.layer(state)));
			expect(result.sha1).toBe("tree-sha-1");
			expect(result.sha2).toBe("tree-sha-2");
		});
	});

	describe("createCommit", () => {
		it("records commit data and returns a SHA", async () => {
			const state = GitCommitTest.empty();
			const sha = await run(state, createCommit("initial commit", "tree-sha-1", ["parent-sha"]));
			expect(sha).toBe("commit-sha-1");
			expect(state.commits).toHaveLength(1);
			expect(state.commits[0]?.message).toBe("initial commit");
			expect(state.commits[0]?.treeSha).toBe("tree-sha-1");
			expect(state.commits[0]?.parentShas).toEqual(["parent-sha"]);
		});
	});

	describe("updateRef", () => {
		it("records ref updates", async () => {
			const state = GitCommitTest.empty();
			await run(state, updateRef("main", "commit-sha-1", true));
			expect(state.refUpdates).toHaveLength(1);
			expect(state.refUpdates[0]).toEqual({ ref: "main", sha: "commit-sha-1", force: true });
		});
	});

	describe("commitFiles", () => {
		it("orchestrates tree, commit, and ref update", async () => {
			const state = GitCommitTest.empty();
			const sha = await run(
				state,
				commitFiles("main", "add files", [
					{ path: "README.md", content: "# Hello" },
					{ path: "src/index.ts", content: "export {}" },
				]),
			);
			expect(sha).toMatch(/^commit-sha-/);
			expect(state.trees).toHaveLength(1);
			expect(state.commits).toHaveLength(1);
			expect(state.refUpdates).toHaveLength(1);
			expect(state.refUpdates[0]?.ref).toBe("main");
			expect(state.commits[0]?.message).toBe("add files");
		});
	});

	describe("GitCommitError", () => {
		it("is a tagged error with correct fields", () => {
			const error = new GitCommitError({
				operation: "tree",
				reason: "invalid tree entry",
			});
			expect(error._tag).toBe("GitCommitError");
			expect(error.operation).toBe("tree");
			expect(error.reason).toBe("invalid tree entry");
		});
	});
});
