import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import { PullRequestCommentError } from "../errors/PullRequestCommentError.js";
import type { PullRequestCommentTestState } from "../layers/PullRequestCommentTest.js";
import { PullRequestCommentTest } from "../layers/PullRequestCommentTest.js";
import { PullRequestComment } from "./PullRequestComment.js";

// -- Shared provide helper --

const provide = <A, E>(state: PullRequestCommentTestState, effect: Effect.Effect<A, E, PullRequestComment>) =>
	Effect.provide(effect, PullRequestCommentTest.layer(state));

const run = <A, E>(state: PullRequestCommentTestState, effect: Effect.Effect<A, E, PullRequestComment>) =>
	Effect.runPromise(provide(state, effect));

// -- Service method shorthands --

const create = (prNumber: number, body: string) =>
	Effect.flatMap(PullRequestComment, (svc) => svc.create(prNumber, body));

const upsert = (prNumber: number, markerKey: string, body: string) =>
	Effect.flatMap(PullRequestComment, (svc) => svc.upsert(prNumber, markerKey, body));

const find = (prNumber: number, markerKey: string) =>
	Effect.flatMap(PullRequestComment, (svc) => svc.find(prNumber, markerKey));

const del = (prNumber: number, commentId: number) =>
	Effect.flatMap(PullRequestComment, (svc) => svc.delete(prNumber, commentId));

describe("PullRequestComment", () => {
	describe("create", () => {
		it("creates a comment and returns the ID", async () => {
			const state = PullRequestCommentTest.empty();
			const id = await run(state, create(42, "Hello PR!"));
			expect(id).toBe(1);
		});

		it("stores the comment in state", async () => {
			const state = PullRequestCommentTest.empty();
			await run(state, create(42, "Hello PR!"));
			const prComments = state.comments.get(42);
			expect(prComments).toHaveLength(1);
			expect(prComments?.[0]?.body).toBe("Hello PR!");
		});

		it("assigns incrementing IDs", async () => {
			const state = PullRequestCommentTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* PullRequestComment;
				const id1 = yield* svc.create(42, "First");
				const id2 = yield* svc.create(42, "Second");
				return [id1, id2];
			});
			const ids = await run(state, program);
			expect(ids).toEqual([1, 2]);
		});

		it("stores comments per PR number", async () => {
			const state = PullRequestCommentTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* PullRequestComment;
				yield* svc.create(1, "Comment on PR 1");
				yield* svc.create(2, "Comment on PR 2");
			});
			await run(state, program);
			expect(state.comments.get(1)).toHaveLength(1);
			expect(state.comments.get(2)).toHaveLength(1);
		});
	});

	describe("upsert", () => {
		it("creates a new comment when no marker found", async () => {
			const state = PullRequestCommentTest.empty();
			const id = await run(state, upsert(42, "build-report", "Build passed"));
			expect(id).toBe(1);
			const prComments = state.comments.get(42);
			expect(prComments).toHaveLength(1);
			expect(prComments?.[0]?.body).toContain("<!-- savvy-web:build-report -->");
			expect(prComments?.[0]?.body).toContain("Build passed");
		});

		it("updates existing comment when marker found", async () => {
			const state = PullRequestCommentTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* PullRequestComment;
				const id1 = yield* svc.upsert(42, "build-report", "Build passed v1");
				const id2 = yield* svc.upsert(42, "build-report", "Build passed v2");
				return [id1, id2];
			});
			const ids = await run(state, program);

			// Same comment ID returned
			expect(ids[0]).toBe(ids[1]);

			// Only one comment exists
			const prComments = state.comments.get(42);
			expect(prComments).toHaveLength(1);

			// Body is updated
			expect(prComments?.[0]?.body).toContain("Build passed v2");
			expect(prComments?.[0]?.body).not.toContain("Build passed v1");
		});

		it("prepends marker to body", async () => {
			const state = PullRequestCommentTest.empty();
			await run(state, upsert(42, "my-key", "Content"));
			const prComments = state.comments.get(42);
			expect(prComments?.[0]?.body).toBe("<!-- savvy-web:my-key -->\nContent");
		});

		it("handles different marker keys independently", async () => {
			const state = PullRequestCommentTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* PullRequestComment;
				yield* svc.upsert(42, "key-a", "Content A");
				yield* svc.upsert(42, "key-b", "Content B");
			});
			await run(state, program);

			const prComments = state.comments.get(42);
			expect(prComments).toHaveLength(2);
		});
	});

	describe("find", () => {
		it("returns Some when marker found", async () => {
			const state = PullRequestCommentTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* PullRequestComment;
				yield* svc.upsert(42, "build-report", "Build passed");
				return yield* svc.find(42, "build-report");
			});
			const result = await run(state, program);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value.body).toContain("Build passed");
				expect(result.value.id).toBe(1);
			}
		});

		it("returns None when marker not found", async () => {
			const state = PullRequestCommentTest.empty();
			const result = await run(state, find(42, "nonexistent"));
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns None when PR has no comments", async () => {
			const state = PullRequestCommentTest.empty();
			const result = await run(state, find(99, "some-key"));
			expect(Option.isNone(result)).toBe(true);
		});

		it("finds correct comment among multiple", async () => {
			const state = PullRequestCommentTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* PullRequestComment;
				yield* svc.upsert(42, "key-a", "Content A");
				yield* svc.upsert(42, "key-b", "Content B");
				return yield* svc.find(42, "key-b");
			});
			const result = await run(state, program);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value.body).toContain("Content B");
			}
		});
	});

	describe("delete", () => {
		it("removes comment from state", async () => {
			const state = PullRequestCommentTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* PullRequestComment;
				const id = yield* svc.create(42, "To be deleted");
				yield* svc.delete(42, id);
			});
			await run(state, program);
			const prComments = state.comments.get(42) ?? [];
			expect(prComments).toHaveLength(0);
		});

		it("does not throw when comment ID does not exist", async () => {
			const state = PullRequestCommentTest.empty();
			await run(state, del(42, 999));
			// No error thrown
		});

		it("only removes the targeted comment", async () => {
			const state = PullRequestCommentTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* PullRequestComment;
				yield* svc.create(42, "Keep this");
				const id2 = yield* svc.create(42, "Delete this");
				yield* svc.delete(42, id2);
			});
			await run(state, program);
			const prComments = state.comments.get(42) ?? [];
			expect(prComments).toHaveLength(1);
			expect(prComments[0]?.body).toBe("Keep this");
		});
	});

	describe("marker format", () => {
		it("uses hidden HTML comment format", async () => {
			const state = PullRequestCommentTest.empty();
			await run(state, upsert(42, "test-key", "body"));
			const prComments = state.comments.get(42);
			expect(prComments?.[0]?.body).toMatch(/^<!-- savvy-web:test-key -->\n/);
		});
	});

	describe("PullRequestCommentError", () => {
		it("is a tagged error", () => {
			const error = new PullRequestCommentError({
				prNumber: 42,
				operation: "create",
				reason: "something went wrong",
			});
			expect(error._tag).toBe("PullRequestCommentError");
			expect(error.prNumber).toBe(42);
			expect(error.operation).toBe("create");
			expect(error.reason).toBe("something went wrong");
		});
	});
});
