import { Effect, LogLevel, Logger } from "effect";
import { describe, expect, it } from "vitest";
import { ActionLogger } from "../services/ActionLogger.js";
import { ActionLoggerTest } from "./ActionLoggerTest.js";

const run = <A, E>(state: ReturnType<typeof ActionLoggerTest.empty>, effect: Effect.Effect<A, E, ActionLogger>) =>
	Effect.runPromise(Effect.provide(effect, ActionLoggerTest.layer(state)));

describe("ActionLoggerTest", () => {
	describe("empty", () => {
		it("creates empty state", () => {
			const state = ActionLoggerTest.empty();
			expect(state.entries).toEqual([]);
			expect(state.groups).toEqual([]);
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
		it("at debug minimum log level, passes through without buffering", async () => {
			const state = ActionLoggerTest.empty();
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(ActionLogger, (svc) => svc.withBuffer("test", Effect.succeed("ok"))).pipe(
						Logger.withMinimumLogLevel(LogLevel.Debug),
					),
					ActionLoggerTest.layer(state),
				),
			);
			expect(result).toBe("ok");
			expect(state.flushedBuffers).toHaveLength(0);
		});

		it("at info minimum log level, flushes on failure", async () => {
			const state = ActionLoggerTest.empty();
			const exit = await Effect.runPromise(
				Effect.exit(
					Effect.provide(
						Effect.flatMap(ActionLogger, (svc) => svc.withBuffer("fail-op", Effect.fail("boom"))).pipe(
							Logger.withMinimumLogLevel(LogLevel.Info),
						),
						ActionLoggerTest.layer(state),
					),
				),
			);
			expect(exit._tag).toBe("Failure");
			expect(state.flushedBuffers).toHaveLength(1);
			expect(state.flushedBuffers[0]?.label).toBe("fail-op");
		});

		it("at info minimum log level, does not flush on success", async () => {
			const state = ActionLoggerTest.empty();
			await run(
				state,
				Effect.flatMap(ActionLogger, (svc) => svc.withBuffer("ok-op", Effect.succeed("done"))),
			);
			expect(state.flushedBuffers).toHaveLength(0);
		});
	});
});
