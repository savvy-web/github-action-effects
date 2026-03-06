import { Effect, FiberRef } from "effect";
import { describe, expect, it } from "vitest";
import { ActionLogger } from "../services/ActionLogger.js";
import { CurrentLogLevel } from "./ActionLoggerLive.js";
import { ActionLoggerTest } from "./ActionLoggerTest.js";

const run = <A, E>(state: ReturnType<typeof ActionLoggerTest.empty>, effect: Effect.Effect<A, E, ActionLogger>) =>
	Effect.runPromise(Effect.provide(effect, ActionLoggerTest.layer(state)));

describe("ActionLoggerTest", () => {
	describe("empty", () => {
		it("creates empty state", () => {
			const state = ActionLoggerTest.empty();
			expect(state.entries).toEqual([]);
			expect(state.groups).toEqual([]);
			expect(state.annotations).toEqual([]);
			expect(state.flushedBuffers).toEqual([]);
		});
	});

	describe("group", () => {
		it("records group name and runs effect", async () => {
			const state = ActionLoggerTest.empty();
			const result = await run(
				state,
				Effect.flatMap(ActionLogger, (svc) => svc.group("build", Effect.succeed(42))),
			);
			expect(result).toBe(42);
			expect(state.groups).toHaveLength(1);
			expect(state.groups[0]?.name).toBe("build");
		});
	});

	describe("withBuffer", () => {
		it("at non-info level, passes through", async () => {
			const state = ActionLoggerTest.empty();
			const result = await Effect.runPromise(
				Effect.provide(
					FiberRef.set(CurrentLogLevel, "debug" as const).pipe(
						Effect.flatMap(() => Effect.flatMap(ActionLogger, (svc) => svc.withBuffer("test", Effect.succeed("ok")))),
					),
					ActionLoggerTest.layer(state),
				),
			);
			expect(result).toBe("ok");
			expect(state.flushedBuffers).toHaveLength(0);
		});

		it("at info level, flushes on failure", async () => {
			const state = ActionLoggerTest.empty();
			const exit = await Effect.runPromise(
				Effect.exit(
					Effect.provide(
						Effect.flatMap(ActionLogger, (svc) => svc.withBuffer("fail-op", Effect.fail("boom"))),
						ActionLoggerTest.layer(state),
					),
				),
			);
			expect(exit._tag).toBe("Failure");
			expect(state.flushedBuffers).toHaveLength(1);
			expect(state.flushedBuffers[0]?.label).toBe("fail-op");
		});

		it("at info level, does not flush on success", async () => {
			const state = ActionLoggerTest.empty();
			await run(
				state,
				Effect.flatMap(ActionLogger, (svc) => svc.withBuffer("ok-op", Effect.succeed("done"))),
			);
			expect(state.flushedBuffers).toHaveLength(0);
		});
	});

	describe("annotationError", () => {
		it("records error annotation without properties", async () => {
			const state = ActionLoggerTest.empty();
			await run(
				state,
				Effect.flatMap(ActionLogger, (svc) => svc.annotationError("test msg")),
			);
			expect(state.annotations).toEqual([{ type: "error", message: "test msg" }]);
		});

		it("records error annotation with properties", async () => {
			const state = ActionLoggerTest.empty();
			const props = { file: "test.ts", startLine: 5 };
			await run(
				state,
				Effect.flatMap(ActionLogger, (svc) => svc.annotationError("msg", props)),
			);
			expect(state.annotations).toEqual([{ type: "error", message: "msg", properties: props }]);
		});
	});

	describe("annotationWarning", () => {
		it("records warning annotation", async () => {
			const state = ActionLoggerTest.empty();
			await run(
				state,
				Effect.flatMap(ActionLogger, (svc) => svc.annotationWarning("warn msg")),
			);
			expect(state.annotations).toEqual([{ type: "warning", message: "warn msg" }]);
		});
	});

	describe("annotationNotice", () => {
		it("records notice annotation", async () => {
			const state = ActionLoggerTest.empty();
			await run(
				state,
				Effect.flatMap(ActionLogger, (svc) => svc.annotationNotice("note msg")),
			);
			expect(state.annotations).toEqual([{ type: "notice", message: "note msg" }]);
		});
	});
});
