import { Data, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { CheckRunError } from "../errors/CheckRunError.js";
import { CheckRunTest } from "../layers/CheckRunTest.js";
import { CheckRun } from "./CheckRun.js";

// -- Shared provide helper --

const provide = <A, E>(state: ReturnType<typeof CheckRunTest.empty>, effect: Effect.Effect<A, E, CheckRun>) =>
	Effect.provide(effect, CheckRunTest.layer(state));

const run = <A, E>(state: ReturnType<typeof CheckRunTest.empty>, effect: Effect.Effect<A, E, CheckRun>) =>
	Effect.runPromise(provide(state, effect));

const runExit = <A, E>(state: ReturnType<typeof CheckRunTest.empty>, effect: Effect.Effect<A, E, CheckRun>) =>
	Effect.runPromise(Effect.exit(provide(state, effect)));

// -- Service method shorthands --

const create = (name: string, headSha: string) => Effect.flatMap(CheckRun, (svc) => svc.create(name, headSha));

const withCheckRun = <A, E>(name: string, headSha: string, effect: (checkRunId: number) => Effect.Effect<A, E>) =>
	Effect.flatMap(CheckRun, (svc) => svc.withCheckRun(name, headSha, effect));

describe("CheckRun", () => {
	describe("create", () => {
		it("creates a check run and returns an ID", async () => {
			const state = CheckRunTest.empty();
			const id = await run(state, create("lint", "abc123"));
			expect(id).toBe(1);
			expect(state.runs).toHaveLength(1);
			expect(state.runs[0]).toMatchObject({
				id: 1,
				name: "lint",
				headSha: "abc123",
				status: "in_progress",
			});
		});

		it("assigns incrementing IDs", async () => {
			const state = CheckRunTest.empty();
			const id1 = await run(state, create("lint", "abc"));
			const id2 = await run(state, create("test", "def"));
			expect(id2).toBe(id1 + 1);
			expect(state.runs).toHaveLength(2);
		});
	});

	describe("update", () => {
		it("silently ignores update for non-existent check run id", async () => {
			const state = CheckRunTest.empty();
			// Should not throw — run with unknown id is a no-op
			await run(
				state,
				Effect.flatMap(CheckRun, (svc) => svc.update(999, { title: "Phantom", summary: "No run" })),
			);
			expect(state.runs).toHaveLength(0);
		});

		it("adds output to an existing check run", async () => {
			const state = CheckRunTest.empty();
			await run(
				state,
				Effect.gen(function* () {
					const svc = yield* CheckRun;
					const id = yield* svc.create("lint", "abc123");
					yield* svc.update(id, { title: "Results", summary: "All good" });
				}),
			);
			expect(state.runs[0].outputs).toHaveLength(1);
			expect(state.runs[0].outputs[0]).toMatchObject({
				title: "Results",
				summary: "All good",
			});
		});

		it("appends multiple outputs", async () => {
			const state = CheckRunTest.empty();
			await run(
				state,
				Effect.gen(function* () {
					const svc = yield* CheckRun;
					const id = yield* svc.create("lint", "abc123");
					yield* svc.update(id, { title: "Step 1", summary: "Done" });
					yield* svc.update(id, { title: "Step 2", summary: "Done" });
				}),
			);
			expect(state.runs[0].outputs).toHaveLength(2);
		});
	});

	describe("complete", () => {
		it("silently ignores complete for non-existent check run id", async () => {
			const state = CheckRunTest.empty();
			await run(
				state,
				Effect.flatMap(CheckRun, (svc) => svc.complete(999, "success")),
			);
			expect(state.runs).toHaveLength(0);
		});

		it("marks check run as completed with conclusion", async () => {
			const state = CheckRunTest.empty();
			await run(
				state,
				Effect.gen(function* () {
					const svc = yield* CheckRun;
					const id = yield* svc.create("lint", "abc123");
					yield* svc.complete(id, "success");
				}),
			);
			expect(state.runs[0].status).toBe("completed");
			expect(state.runs[0].conclusion).toBe("success");
		});

		it("attaches final output when provided", async () => {
			const state = CheckRunTest.empty();
			await run(
				state,
				Effect.gen(function* () {
					const svc = yield* CheckRun;
					const id = yield* svc.create("lint", "abc123");
					yield* svc.complete(id, "failure", { title: "Failed", summary: "2 errors" });
				}),
			);
			expect(state.runs[0].conclusion).toBe("failure");
			expect(state.runs[0].outputs).toHaveLength(1);
			expect(state.runs[0].outputs[0].title).toBe("Failed");
		});
	});

	describe("withCheckRun", () => {
		it("creates and completes with success on successful effect", async () => {
			const state = CheckRunTest.empty();
			const result = await run(
				state,
				withCheckRun("lint", "abc123", (_checkRunId) => Effect.succeed("done")),
			);
			expect(result).toBe("done");
			expect(state.runs).toHaveLength(1);
			expect(state.runs[0].status).toBe("completed");
			expect(state.runs[0].conclusion).toBe("success");
		});

		it("creates and completes with failure on failed effect", async () => {
			const state = CheckRunTest.empty();

			class TestError extends Data.TaggedError("TestError")<{ readonly message: string }> {}

			const exit = await runExit(
				state,
				withCheckRun("lint", "abc123", (_checkRunId) => Effect.fail(new TestError({ message: "boom" }))),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			expect(state.runs).toHaveLength(1);
			expect(state.runs[0].status).toBe("completed");
			expect(state.runs[0].conclusion).toBe("failure");
		});

		it("passes the check run ID to the effect", async () => {
			const state = CheckRunTest.empty();
			const result = await run(
				state,
				withCheckRun("lint", "abc123", (checkRunId) => Effect.succeed(checkRunId)),
			);
			expect(result).toBe(1);
		});

		it("propagates the original error after completing with failure", async () => {
			const state = CheckRunTest.empty();

			class MyError extends Data.TaggedError("MyError")<{ readonly code: number }> {}

			const exit = await runExit(
				state,
				withCheckRun("lint", "abc123", (_id) => Effect.fail(new MyError({ code: 42 }))),
			);

			expect(Exit.isFailure(exit)).toBe(true);
			if (Exit.isFailure(exit)) {
				const error = exit.cause;
				// The original error should be in the cause
				expect(String(error)).toContain("MyError");
			}
		});
	});

	describe("CheckRunError", () => {
		it("is a tagged error with correct fields", () => {
			const error = new CheckRunError({
				name: "lint",
				operation: "create",
				reason: "API rate limited",
			});
			expect(error._tag).toBe("CheckRunError");
			expect(error.name).toBe("lint");
			expect(error.operation).toBe("create");
			expect(error.reason).toBe("API rate limited");
		});
	});
});
