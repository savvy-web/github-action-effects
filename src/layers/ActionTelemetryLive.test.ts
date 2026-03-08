import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ActionTelemetry } from "../services/ActionTelemetry.js";
import { ActionTelemetryLive } from "./ActionTelemetryLive.js";

const run = <A, E>(effect: Effect.Effect<A, E, ActionTelemetry>) =>
	Effect.runPromise(Effect.provide(effect, ActionTelemetryLive));

describe("ActionTelemetryLive", () => {
	describe("metric", () => {
		it("records a metric with value and unit", async () => {
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.metric("bundle-size", 2048, "bytes");
				return yield* svc.getMetrics();
			});

			const metrics = await run(program);
			expect(metrics).toHaveLength(1);
			const m = metrics[0];
			expect(m?.name).toBe("bundle-size");
			expect(m?.value).toBe(2048);
			expect(m?.unit).toBe("bytes");
			expect(m?.timestamp).toBeGreaterThan(0);
		});

		it("records a metric without unit", async () => {
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.metric("count", 5);
				return yield* svc.getMetrics();
			});

			const metrics = await run(program);
			expect(metrics[0]?.unit).toBeUndefined();
		});

		it("records multiple metrics with increasing timestamps", async () => {
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.metric("a", 1);
				yield* svc.metric("b", 2);
				yield* svc.metric("c", 3);
				return yield* svc.getMetrics();
			});

			const metrics = await run(program);
			expect(metrics).toHaveLength(3);
			for (const m of metrics) {
				expect(m.timestamp).toBeGreaterThan(0);
			}
		});
	});

	describe("attribute", () => {
		it("is a no-op when no span is active", async () => {
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.attribute("key", "value");
			});

			// Should not throw even without an active span
			await expect(run(program)).resolves.toBeUndefined();
		});
	});

	describe("getMetrics", () => {
		it("returns empty array when nothing recorded", async () => {
			const metrics = await run(Effect.flatMap(ActionTelemetry, (svc) => svc.getMetrics()));
			expect(metrics).toEqual([]);
		});
	});
});
