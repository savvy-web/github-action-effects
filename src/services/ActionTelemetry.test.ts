import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ActionTelemetryTestState } from "../layers/ActionTelemetryTest.js";
import { ActionTelemetryTest } from "../layers/ActionTelemetryTest.js";
import { ActionTelemetry } from "./ActionTelemetry.js";

// -- Shared helpers --

const provide = <A, E>(state: ActionTelemetryTestState, effect: Effect.Effect<A, E, ActionTelemetry>) =>
	Effect.provide(effect, ActionTelemetryTest.layer(state));

const run = <A, E>(state: ActionTelemetryTestState, effect: Effect.Effect<A, E, ActionTelemetry>) =>
	Effect.runPromise(provide(state, effect));

describe("ActionTelemetry", () => {
	describe("span", () => {
		it("records a span and returns the inner result", async () => {
			const state = ActionTelemetryTest.empty();
			const result = await run(
				state,
				Effect.flatMap(ActionTelemetry, (svc) => svc.span("my-span", Effect.succeed(42))),
			);

			expect(result).toBe(42);
			expect(state.spans).toHaveLength(1);
			expect(state.spans[0]?.name).toBe("my-span");
		});

		it("propagates inner effect errors", async () => {
			const state = ActionTelemetryTest.empty();
			const exit = await Effect.runPromise(
				Effect.exit(
					provide(
						state,
						Effect.flatMap(ActionTelemetry, (svc) => svc.span("failing", Effect.fail("boom"))),
					),
				),
			);

			expect(exit._tag).toBe("Failure");
		});

		it("records multiple spans in order", async () => {
			const state = ActionTelemetryTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.span("first", Effect.succeed("a"));
				yield* svc.span("second", Effect.succeed("b"));
				yield* svc.span("third", Effect.succeed("c"));
			});

			await run(state, program);
			expect(state.spans).toHaveLength(3);
			expect(state.spans.map((s) => s.name)).toEqual(["first", "second", "third"]);
		});

		it("records spans with zero duration in test layer", async () => {
			const state = ActionTelemetryTest.empty();
			await run(
				state,
				Effect.flatMap(ActionTelemetry, (svc) => svc.span("test-span", Effect.succeed(undefined))),
			);

			expect(state.spans[0]?.duration).toBe(0);
			expect(state.spans[0]?.startTime).toBe(0);
			expect(state.spans[0]?.endTime).toBe(0);
		});
	});

	describe("metric", () => {
		it("records a metric value", async () => {
			const state = ActionTelemetryTest.empty();
			await run(
				state,
				Effect.flatMap(ActionTelemetry, (svc) => svc.metric("file-count", 15)),
			);

			expect(state.metrics).toHaveLength(1);
			expect(state.metrics[0]?.name).toBe("file-count");
			expect(state.metrics[0]?.value).toBe(15);
		});

		it("records a metric with a unit", async () => {
			const state = ActionTelemetryTest.empty();
			await run(
				state,
				Effect.flatMap(ActionTelemetry, (svc) => svc.metric("bundle-size", 1024, "bytes")),
			);

			expect(state.metrics[0]?.unit).toBe("bytes");
		});

		it("records a metric without a unit", async () => {
			const state = ActionTelemetryTest.empty();
			await run(
				state,
				Effect.flatMap(ActionTelemetry, (svc) => svc.metric("count", 5)),
			);

			expect(state.metrics[0]?.unit).toBeUndefined();
		});

		it("records multiple metrics", async () => {
			const state = ActionTelemetryTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.metric("a", 1);
				yield* svc.metric("b", 2);
				yield* svc.metric("c", 3);
			});

			await run(state, program);
			expect(state.metrics).toHaveLength(3);
			expect(state.metrics.map((m) => m.name)).toEqual(["a", "b", "c"]);
		});
	});

	describe("attribute", () => {
		it("records an attribute in test state", async () => {
			const state = ActionTelemetryTest.empty();
			await run(
				state,
				Effect.flatMap(ActionTelemetry, (svc) => svc.attribute("repo", "my-repo")),
			);

			expect(state.attributes.get("repo")).toBe("my-repo");
		});
	});

	describe("getTimings", () => {
		it("returns all recorded spans and metrics", async () => {
			const state = ActionTelemetryTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.span("span-a", Effect.succeed(undefined));
				yield* svc.metric("metric-a", 10);
				return yield* svc.getTimings();
			});

			const timings = await run(state, program);
			expect(timings.spans).toHaveLength(1);
			expect(timings.spans[0]?.name).toBe("span-a");
			expect(timings.metrics).toHaveLength(1);
			expect(timings.metrics[0]?.name).toBe("metric-a");
		});

		it("returns empty arrays when nothing recorded", async () => {
			const state = ActionTelemetryTest.empty();
			const timings = await run(
				state,
				Effect.flatMap(ActionTelemetry, (svc) => svc.getTimings()),
			);

			expect(timings.spans).toEqual([]);
			expect(timings.metrics).toEqual([]);
		});
	});
});
