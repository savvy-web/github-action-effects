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

	describe("getMetrics", () => {
		it("returns all recorded metrics", async () => {
			const state = ActionTelemetryTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.metric("metric-a", 10);
				yield* svc.metric("metric-b", 20, "ms");
				return yield* svc.getMetrics();
			});

			const metrics = await run(state, program);
			expect(metrics).toHaveLength(2);
			expect(metrics[0]?.name).toBe("metric-a");
			expect(metrics[1]?.name).toBe("metric-b");
		});

		it("returns empty array when nothing recorded", async () => {
			const state = ActionTelemetryTest.empty();
			const metrics = await run(
				state,
				Effect.flatMap(ActionTelemetry, (svc) => svc.getMetrics()),
			);

			expect(metrics).toEqual([]);
		});
	});
});
