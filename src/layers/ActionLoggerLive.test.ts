import { debug, endGroup, error, info, notice, startGroup, warning } from "@actions/core";
import { Effect, FiberRef } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionLogger } from "../services/ActionLogger.js";
import { ActionLoggerLayer, ActionLoggerLive, CurrentLogLevel, setLogLevel } from "./ActionLoggerLive.js";

vi.mock("@actions/core", () => ({
	debug: vi.fn(),
	info: vi.fn(),
	warning: vi.fn(),
	error: vi.fn(),
	notice: vi.fn(),
	startGroup: vi.fn(),
	endGroup: vi.fn(),
}));

const run = <A, E>(effect: Effect.Effect<A, E, ActionLogger>) =>
	Effect.runPromise(Effect.provide(effect, ActionLoggerLive));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("CurrentLogLevel", () => {
	it("defaults to info", async () => {
		const level = await Effect.runPromise(FiberRef.get(CurrentLogLevel));
		expect(level).toBe("info");
	});
});

describe("setLogLevel", () => {
	it("changes the log level for the current fiber", async () => {
		const level = await Effect.runPromise(
			setLogLevel("debug").pipe(Effect.flatMap(() => FiberRef.get(CurrentLogLevel))),
		);
		expect(level).toBe("debug");
	});
});

describe("makeActionLogger", () => {
	const runWithLogger = <A>(effect: Effect.Effect<A>) => Effect.runPromise(Effect.provide(effect, ActionLoggerLayer));

	it("always writes to core.debug", async () => {
		await runWithLogger(Effect.log("hello"));
		expect(debug).toHaveBeenCalledWith("hello");
	});

	it("at info level, does not emit info-level log to core.info", async () => {
		await runWithLogger(Effect.log("hello"));
		expect(info).not.toHaveBeenCalled();
	});

	it("at info level, emits warnings to core.warning", async () => {
		await runWithLogger(Effect.logWarning("warn msg"));
		expect(warning).toHaveBeenCalledWith("warn msg");
	});

	it("at info level, emits errors to core.error", async () => {
		await runWithLogger(Effect.logError("err msg"));
		expect(error).toHaveBeenCalledWith("err msg");
	});

	it("at debug level, emits info-level log to core.info", async () => {
		await runWithLogger(setLogLevel("debug").pipe(Effect.flatMap(() => Effect.log("debug msg"))));
		expect(info).toHaveBeenCalledWith("debug msg");
	});

	it("at verbose level, emits info-level log to core.info", async () => {
		await runWithLogger(setLogLevel("verbose").pipe(Effect.flatMap(() => Effect.log("verbose msg"))));
		expect(info).toHaveBeenCalledWith("verbose msg");
	});

	it("formats non-string messages as JSON", async () => {
		await runWithLogger(setLogLevel("debug").pipe(Effect.flatMap(() => Effect.log({ key: "value" }))));
		expect(debug).toHaveBeenCalledWith('{"key":"value"}');
	});
});

describe("ActionLoggerLive", () => {
	describe("group", () => {
		it("wraps effect in startGroup/endGroup", async () => {
			await run(Effect.flatMap(ActionLogger, (svc) => svc.group("my group", Effect.succeed("ok"))));
			expect(startGroup).toHaveBeenCalledWith("my group");
			expect(endGroup).toHaveBeenCalled();
		});

		it("calls endGroup even on failure", async () => {
			await Effect.runPromise(
				Effect.exit(
					Effect.provide(
						Effect.flatMap(ActionLogger, (svc) => svc.group("fail group", Effect.fail("boom"))),
						ActionLoggerLive,
					),
				),
			);
			expect(startGroup).toHaveBeenCalledWith("fail group");
			expect(endGroup).toHaveBeenCalled();
		});
	});

	describe("withBuffer", () => {
		it("at non-info level, passes through without buffering", async () => {
			const result = await Effect.runPromise(
				Effect.provide(
					FiberRef.set(CurrentLogLevel, "debug" as const).pipe(
						Effect.flatMap(() => Effect.flatMap(ActionLogger, (svc) => svc.withBuffer("test", Effect.succeed(42)))),
					),
					ActionLoggerLive,
				),
			);
			expect(result).toBe(42);
		});

		it("at info level, buffers and discards on success", async () => {
			const result = await run(Effect.flatMap(ActionLogger, (svc) => svc.withBuffer("test", Effect.succeed("ok"))));
			expect(result).toBe("ok");
		});

		it("at info level, flushes buffer on failure", async () => {
			const exit = await Effect.runPromise(
				Effect.exit(
					Effect.provide(
						Effect.flatMap(ActionLogger, (svc) =>
							svc.withBuffer("fail-op", Effect.log("buffered line").pipe(Effect.flatMap(() => Effect.fail("boom")))),
						),
						ActionLoggerLive,
					),
				),
			);
			expect(exit._tag).toBe("Failure");
			const infoCalls = vi.mocked(info).mock.calls.map((c) => c[0]);
			expect(infoCalls.some((c) => c.includes("Buffered output"))).toBe(true);
		});
	});

	describe("annotationError", () => {
		it("emits error annotation without properties", async () => {
			await run(Effect.flatMap(ActionLogger, (svc) => svc.annotationError("test error")));
			expect(error).toHaveBeenCalledWith("test error");
		});

		it("emits error annotation with properties", async () => {
			const props = { file: "test.ts", startLine: 10 };
			await run(Effect.flatMap(ActionLogger, (svc) => svc.annotationError("test error", props)));
			expect(error).toHaveBeenCalledWith("test error", props);
		});
	});

	describe("annotationWarning", () => {
		it("emits warning annotation", async () => {
			await run(Effect.flatMap(ActionLogger, (svc) => svc.annotationWarning("test warning")));
			expect(warning).toHaveBeenCalledWith("test warning");
		});

		it("emits warning annotation with properties", async () => {
			const props = { file: "test.ts", startLine: 5 };
			await run(Effect.flatMap(ActionLogger, (svc) => svc.annotationWarning("test warning", props)));
			expect(warning).toHaveBeenCalledWith("test warning", props);
		});
	});

	describe("annotationNotice", () => {
		it("emits notice annotation", async () => {
			await run(Effect.flatMap(ActionLogger, (svc) => svc.annotationNotice("test notice")));
			expect(notice).toHaveBeenCalledWith("test notice");
		});

		it("emits notice annotation with properties", async () => {
			const props = { file: "test.ts", startLine: 1 };
			await run(Effect.flatMap(ActionLogger, (svc) => svc.annotationNotice("test notice", props)));
			expect(notice).toHaveBeenCalledWith("test notice", props);
		});
	});
});
