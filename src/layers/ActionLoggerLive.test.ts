import { Effect, LogLevel, Logger } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionLogger } from "../services/ActionLogger.js";
import { ActionLoggerLive } from "./ActionLoggerLive.js";

const run = <A, E>(effect: Effect.Effect<A, E, ActionLogger>) =>
	Effect.runPromise(Effect.provide(effect, ActionLoggerLive));

const runExit = <A, E>(effect: Effect.Effect<A, E, ActionLogger>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, ActionLoggerLive)));

describe("ActionLoggerLive", () => {
	describe("group", () => {
		let writeSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		});

		afterEach(() => {
			writeSpy.mockRestore();
		});

		it("writes ::group:: and ::endgroup:: to stdout", async () => {
			await run(Effect.flatMap(ActionLogger, (svc) => svc.group("my group", Effect.succeed("ok"))));
			const written = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
			expect(written.some((s: string) => s.includes("::group::my group"))).toBe(true);
			expect(written.some((s: string) => s.includes("::endgroup::"))).toBe(true);
		});

		it("writes ::endgroup:: even on failure", async () => {
			await runExit(Effect.flatMap(ActionLogger, (svc) => svc.group("fail group", Effect.fail("boom"))));
			const written = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
			expect(written.some((s: string) => s.includes("::group::fail group"))).toBe(true);
			expect(written.some((s: string) => s.includes("::endgroup::"))).toBe(true);
		});
	});

	describe("withBuffer", () => {
		let writeSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		});

		afterEach(() => {
			writeSpy.mockRestore();
		});

		it("at debug minimum log level, passes through without buffering", async () => {
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(ActionLogger, (svc) => svc.withBuffer("test", Effect.succeed(42))).pipe(
						Logger.withMinimumLogLevel(LogLevel.Debug),
					),
					ActionLoggerLive,
				),
			);
			expect(result).toBe(42);
		});

		it("at info minimum log level, buffers and discards on success", async () => {
			const result = await Effect.runPromise(
				Effect.provide(
					Effect.flatMap(ActionLogger, (svc) =>
						svc.withBuffer("test", Effect.log("verbose line").pipe(Effect.map(() => "ok"))),
					).pipe(Logger.withMinimumLogLevel(LogLevel.Info)),
					ActionLoggerLive,
				),
			);
			expect(result).toBe("ok");
			// The verbose log should NOT have been written to stdout
			const written = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
			expect(written.some((s: string) => s.includes("verbose line"))).toBe(false);
		});

		it("at info minimum log level, flushes buffer to stdout on failure", async () => {
			const exit = await Effect.runPromise(
				Effect.exit(
					Effect.provide(
						Effect.flatMap(ActionLogger, (svc) =>
							svc.withBuffer("fail-op", Effect.log("buffered line").pipe(Effect.flatMap(() => Effect.fail("boom")))),
						).pipe(Logger.withMinimumLogLevel(LogLevel.Info)),
						ActionLoggerLive,
					),
				),
			);
			expect(exit._tag).toBe("Failure");
			const written = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
			expect(written.some((s: string) => s.includes("Buffered output"))).toBe(true);
		});
	});

	describe("notice", () => {
		let writeSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		});

		afterEach(() => {
			writeSpy.mockRestore();
		});

		it("issues a ::notice:: command", async () => {
			await run(Effect.flatMap(ActionLogger, (svc) => svc.notice("heads up")));
			const written = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
			expect(written.some((s: string) => s.includes("::notice::heads up"))).toBe(true);
		});

		it("forwards annotation properties (startLine→line, startColumn→col)", async () => {
			await run(Effect.flatMap(ActionLogger, (svc) => svc.notice("x", { file: "a.ts", startLine: 3, startColumn: 5 })));
			const written = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
			expect(written.some((s: string) => s.includes("::notice file=a.ts,line=3,col=5::x"))).toBe(true);
		});

		it("logInfo still emits plain stdout, not ::notice:: (no level remap)", async () => {
			await run(Effect.logInfo("routine info"));
			const written = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
			expect(written.some((s: string) => s.includes("::notice"))).toBe(false);
		});
	});

	describe("per-group buffer flush", () => {
		let writeSpy: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		});

		afterEach(() => {
			writeSpy.mockRestore();
		});

		const failingGroupProgram = Effect.flatMap(ActionLogger, (svc) =>
			svc.withBuffer(
				"action",
				svc.group("install", Effect.log("buffered detail").pipe(Effect.flatMap(() => Effect.fail("boom")))),
			),
		).pipe(Logger.withMinimumLogLevel(LogLevel.Info));

		it("flushes the active buffer inside a failing group, before ::endgroup::", async () => {
			await Effect.runPromise(Effect.exit(Effect.provide(failingGroupProgram, ActionLoggerLive)));
			const written = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
			const bufferIdx = written.findIndex((s: string) => s.includes("buffered detail"));
			const endGroupIdx = written.findIndex((s: string) => s.includes("::endgroup::"));
			expect(bufferIdx).toBeGreaterThanOrEqual(0);
			expect(endGroupIdx).toBeGreaterThanOrEqual(0);
			expect(bufferIdx).toBeLessThan(endGroupIdx);
		});

		it("flushes the buffered output exactly once", async () => {
			await Effect.runPromise(Effect.exit(Effect.provide(failingGroupProgram, ActionLoggerLive)));
			const written = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
			const headerCount = written.filter((s: string) => s.includes("--- Buffered output")).length;
			expect(headerCount).toBe(1);
		});

		it("still flushes at the withBuffer boundary when the failure is outside any group", async () => {
			const program = Effect.flatMap(ActionLogger, (svc) =>
				svc.withBuffer("action", Effect.log("ungrouped detail").pipe(Effect.flatMap(() => Effect.fail("boom")))),
			).pipe(Logger.withMinimumLogLevel(LogLevel.Info));
			await Effect.runPromise(Effect.exit(Effect.provide(program, ActionLoggerLive)));
			const written = writeSpy.mock.calls.map((c: unknown[]) => String(c[0]));
			expect(written.some((s: string) => s.includes("ungrouped detail"))).toBe(true);
		});
	});
});
