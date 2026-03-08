import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ErrorAccumulator } from "./ErrorAccumulator.js";

describe("ErrorAccumulator", () => {
	describe("forEachAccumulate", () => {
		it("collects all successes when no failures", async () => {
			const result = await Effect.runPromise(
				ErrorAccumulator.forEachAccumulate([1, 2, 3], (n) => Effect.succeed(n * 2)),
			);

			expect(result.successes).toEqual([2, 4, 6]);
			expect(result.failures).toEqual([]);
		});

		it("collects all failures when everything fails", async () => {
			const result = await Effect.runPromise(
				ErrorAccumulator.forEachAccumulate([1, 2, 3], (n) => Effect.fail(`error-${n}`)),
			);

			expect(result.successes).toEqual([]);
			expect(result.failures).toEqual([
				{ item: 1, error: "error-1" },
				{ item: 2, error: "error-2" },
				{ item: 3, error: "error-3" },
			]);
		});

		it("partitions mixed successes and failures", async () => {
			const result = await Effect.runPromise(
				ErrorAccumulator.forEachAccumulate([1, 2, 3, 4], (n) =>
					n % 2 === 0 ? Effect.succeed(n * 10) : Effect.fail(`odd-${n}`),
				),
			);

			expect(result.successes).toEqual([20, 40]);
			expect(result.failures).toEqual([
				{ item: 1, error: "odd-1" },
				{ item: 3, error: "odd-3" },
			]);
		});

		it("handles empty input", async () => {
			const result = await Effect.runPromise(ErrorAccumulator.forEachAccumulate([], (n: number) => Effect.succeed(n)));

			expect(result.successes).toEqual([]);
			expect(result.failures).toEqual([]);
		});

		it("preserves item reference in failures", async () => {
			const items = [
				{ id: 1, name: "alice" },
				{ id: 2, name: "bob" },
			];

			const result = await Effect.runPromise(
				ErrorAccumulator.forEachAccumulate(items, (_item) => Effect.fail("always fails")),
			);

			expect(result.failures[0].item).toBe(items[0]);
			expect(result.failures[1].item).toBe(items[1]);
		});
	});

	describe("forEachAccumulateConcurrent", () => {
		it("processes items with concurrency", async () => {
			const result = await Effect.runPromise(
				ErrorAccumulator.forEachAccumulateConcurrent([1, 2, 3, 4], (n) => Effect.succeed(n * 2), 2),
			);

			expect(result.successes).toEqual([2, 4, 6, 8]);
			expect(result.failures).toEqual([]);
		});

		it("collects failures with concurrency", async () => {
			const result = await Effect.runPromise(
				ErrorAccumulator.forEachAccumulateConcurrent(
					[1, 2, 3],
					(n) => (n === 2 ? Effect.fail("boom") : Effect.succeed(n)),
					2,
				),
			);

			expect(result.successes).toEqual([1, 3]);
			expect(result.failures).toEqual([{ item: 2, error: "boom" }]);
		});

		it("handles empty input with concurrency", async () => {
			const result = await Effect.runPromise(
				ErrorAccumulator.forEachAccumulateConcurrent([], (n: number) => Effect.succeed(n), 4),
			);

			expect(result.successes).toEqual([]);
			expect(result.failures).toEqual([]);
		});

		it("works with concurrency of 1 (sequential)", async () => {
			const order: number[] = [];

			const result = await Effect.runPromise(
				ErrorAccumulator.forEachAccumulateConcurrent(
					[1, 2, 3],
					(n) =>
						Effect.sync(() => {
							order.push(n);
							return n * 10;
						}),
					1,
				),
			);

			expect(result.successes).toEqual([10, 20, 30]);
			expect(order).toEqual([1, 2, 3]);
		});

		it("preserves order of results", async () => {
			const result = await Effect.runPromise(
				ErrorAccumulator.forEachAccumulateConcurrent([5, 4, 3, 2, 1], (n) => Effect.succeed(n), 3),
			);

			expect(result.successes).toEqual([5, 4, 3, 2, 1]);
		});
	});
});
