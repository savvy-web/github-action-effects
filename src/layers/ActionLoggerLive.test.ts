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
});
