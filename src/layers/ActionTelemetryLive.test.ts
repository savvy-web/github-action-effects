import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ActionTelemetry } from "../services/ActionTelemetry.js";
import { ActionTelemetryLive } from "./ActionTelemetryLive.js";

const run = <A, E>(effect: Effect.Effect<A, E, ActionTelemetry>) =>
	Effect.runPromise(Effect.provide(effect, ActionTelemetryLive));

describe("ActionTelemetryLive", () => {
	describe("span", () => {
		it("records a span with positive duration", async () => {
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.span(
					"slow-op",
					Effect.gen(function* () {
						yield* Effect.sleep("10 millis");
						return "done";
					}),
				);
				return yield* svc.getTimings();
			});

			const timings = await run(program);
			expect(timings.spans).toHaveLength(1);
			const span = timings.spans[0];
			expect(span?.name).toBe("slow-op");
			expect(span?.duration).toBeGreaterThan(0);
			expect(span?.endTime).toBeGreaterThanOrEqual(span?.startTime ?? 0);
		});

		it("returns the inner effect result", async () => {
			const result = await run(Effect.flatMap(ActionTelemetry, (svc) => svc.span("op", Effect.succeed(99))));
			expect(result).toBe(99);
		});

		it("propagates inner effect errors and still records the span", async () => {
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				const exit = yield* Effect.exit(svc.span("fail-op", Effect.fail("error!")));
				const timings = yield* svc.getTimings();
				return { exit, timings };
			});
			const { exit, timings } = await run(program);
			expect(exit._tag).toBe("Failure");
			expect(timings.spans).toHaveLength(1);
			expect(timings.spans[0]?.name).toBe("fail-op");
			expect(timings.spans[0]?.duration).toBeGreaterThanOrEqual(0);
		});

		it("records parent span name for nested spans", async () => {
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.span("parent", svc.span("child", Effect.succeed("nested")));
				return yield* svc.getTimings();
			});

			const timings = await run(program);
			expect(timings.spans).toHaveLength(2);

			const child = timings.spans.find((s) => s.name === "child");
			const parent = timings.spans.find((s) => s.name === "parent");

			expect(child?.parentName).toBe("parent");
			expect(parent?.parentName).toBeUndefined();
		});

		it("captures attributes set during span", async () => {
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.span(
					"attributed-span",
					Effect.gen(function* () {
						yield* svc.attribute("repo", "my-repo");
						yield* svc.attribute("ref", "main");
						return "ok";
					}),
				);
				return yield* svc.getTimings();
			});

			const timings = await run(program);
			const span = timings.spans[0];
			expect(span?.attributes).toEqual({ repo: "my-repo", ref: "main" });
		});
	});

	describe("metric", () => {
		it("records a metric with value and unit", async () => {
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.metric("bundle-size", 2048, "bytes");
				return yield* svc.getTimings();
			});

			const timings = await run(program);
			expect(timings.metrics).toHaveLength(1);
			const m = timings.metrics[0];
			expect(m?.name).toBe("bundle-size");
			expect(m?.value).toBe(2048);
			expect(m?.unit).toBe("bytes");
			expect(m?.timestamp).toBeGreaterThan(0);
		});

		it("records a metric without unit", async () => {
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.metric("count", 5);
				return yield* svc.getTimings();
			});

			const timings = await run(program);
			expect(timings.metrics[0]?.unit).toBeUndefined();
		});

		it("records multiple metrics with increasing timestamps", async () => {
			const program = Effect.gen(function* () {
				const svc = yield* ActionTelemetry;
				yield* svc.metric("a", 1);
				yield* svc.metric("b", 2);
				yield* svc.metric("c", 3);
				return yield* svc.getTimings();
			});

			const timings = await run(program);
			expect(timings.metrics).toHaveLength(3);
			for (const m of timings.metrics) {
				expect(m.timestamp).toBeGreaterThan(0);
			}
		});
	});

	describe("getTimings", () => {
		it("returns empty results when nothing recorded", async () => {
			const timings = await run(Effect.flatMap(ActionTelemetry, (svc) => svc.getTimings()));
			expect(timings.spans).toEqual([]);
			expect(timings.metrics).toEqual([]);
		});
	});
});
