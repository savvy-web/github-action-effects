import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import type { CompletedSpan } from "./InMemoryTracer.js";
import { InMemoryTracer } from "./InMemoryTracer.js";

type InMemoryTracerContext = Effect.Effect.Context<ReturnType<typeof InMemoryTracer.getSpans>>;

const run = <A>(
	effect: Effect.Effect<A, never, InMemoryTracerContext>,
): Promise<{
	readonly result: A;
	readonly spans: ReadonlyArray<CompletedSpan>;
}> =>
	Effect.gen(function* () {
		const result = yield* effect;
		const spans = yield* InMemoryTracer.getSpans();
		return { result, spans };
	}).pipe(Effect.provide(InMemoryTracer.layer), Effect.runPromise);

const runWithSpans = <A, E>(
	effect: Effect.Effect<A, E, InMemoryTracerContext>,
): Promise<{
	readonly exit: Exit.Exit<A, E>;
	readonly spans: ReadonlyArray<CompletedSpan>;
}> =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(effect);
		const spans = yield* InMemoryTracer.getSpans();
		return { exit, spans };
	}).pipe(Effect.provide(InMemoryTracer.layer), Effect.runPromise);

describe("InMemoryTracer", () => {
	describe("span capture", () => {
		it("captures spans created by Effect.withSpan", async () => {
			const { result, spans } = await run(Effect.succeed(42).pipe(Effect.withSpan("my-span")));
			expect(result).toBe(42);
			expect(spans).toHaveLength(1);
			expect(spans[0]?.name).toBe("my-span");
			expect(spans[0]?.status).toBe("ok");
		});

		it("captures multiple spans", async () => {
			const { spans } = await run(
				Effect.all([
					Effect.succeed(1).pipe(Effect.withSpan("span-a")),
					Effect.succeed(2).pipe(Effect.withSpan("span-b")),
				]),
			);
			expect(spans).toHaveLength(2);
			const names = spans.map((s) => s.name);
			expect(names).toContain("span-a");
			expect(names).toContain("span-b");
		});
	});

	describe("parent-child relationships", () => {
		it("records parentName for nested spans", async () => {
			const { spans } = await run(Effect.succeed(42).pipe(Effect.withSpan("child")).pipe(Effect.withSpan("parent")));
			expect(spans).toHaveLength(2);
			const child = spans.find((s) => s.name === "child");
			const parent = spans.find((s) => s.name === "parent");
			expect(child?.parentName).toBe("parent");
			expect(parent?.parentName).toBeUndefined();
		});
	});

	describe("attributes", () => {
		it("captures attributes set via Effect.annotateCurrentSpan", async () => {
			const { spans } = await run(
				Effect.void.pipe(
					Effect.tap(() => Effect.annotateCurrentSpan("key", "value")),
					Effect.withSpan("annotated"),
				),
			);
			expect(spans).toHaveLength(1);
			expect(spans[0]?.attributes).toEqual({ key: "value" });
		});

		it("captures multiple attributes", async () => {
			const { spans } = await run(
				Effect.void.pipe(
					Effect.tap(() => Effect.annotateCurrentSpan("a", "1")),
					Effect.tap(() => Effect.annotateCurrentSpan("b", "2")),
					Effect.withSpan("multi-attr"),
				),
			);
			expect(spans[0]?.attributes).toEqual({ a: "1", b: "2" });
		});
	});

	describe("duration", () => {
		it("records positive duration for timed operations", async () => {
			const { spans } = await run(Effect.sleep("10 millis").pipe(Effect.withSpan("timed")));
			expect(spans).toHaveLength(1);
			const span = spans[0];
			expect(span).toBeDefined();
			expect(span?.duration).toBeGreaterThan(0);
			expect(span?.endTime).toBeGreaterThanOrEqual(span?.startTime ?? 0);
		});
	});

	describe("error status", () => {
		it("records status 'error' for failed spans", async () => {
			const { exit, spans } = await runWithSpans(Effect.fail("boom").pipe(Effect.withSpan("failing")));
			expect(Exit.isFailure(exit)).toBe(true);
			expect(spans).toHaveLength(1);
			expect(spans[0]?.name).toBe("failing");
			expect(spans[0]?.status).toBe("error");
		});

		it("records status 'ok' for successful spans", async () => {
			const { spans } = await run(Effect.succeed("ok").pipe(Effect.withSpan("success")));
			expect(spans[0]?.status).toBe("ok");
		});
	});

	describe("timing values", () => {
		it("records startTime and endTime as numbers", async () => {
			const { spans } = await run(Effect.succeed(1).pipe(Effect.withSpan("timing-test")));
			const span = spans[0];
			expect(span).toBeDefined();
			expect(typeof span?.startTime).toBe("number");
			expect(typeof span?.endTime).toBe("number");
			expect(typeof span?.duration).toBe("number");
		});
	});
});
