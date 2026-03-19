import type { Context } from "effect";
import { Effect, FiberRef, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ActionLogger } from "../services/ActionLogger.js";
import { ActionsCore } from "../services/ActionsCore.js";
import { ActionLoggerLayer, ActionLoggerLive, CurrentLogLevel, setLogLevel } from "./ActionLoggerLive.js";

const mockCore = (overrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {}) =>
	Layer.succeed(ActionsCore, {
		getInput: () => "",
		getMultilineInput: () => [],
		getBooleanInput: () => false,
		setOutput: () => {},
		setFailed: () => {},
		exportVariable: () => {},
		addPath: () => {},
		setSecret: () => {},
		info: () => {},
		debug: () => {},
		warning: () => {},
		error: () => {},
		notice: () => {},
		startGroup: () => {},
		endGroup: () => {},
		getState: () => "",
		saveState: () => {},
		summary: { write: () => Promise.resolve(), addRaw: () => ({ write: () => Promise.resolve() }) },
		...overrides,
	});

const run = <A, E>(
	effect: Effect.Effect<A, E, ActionLogger>,
	coreOverrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {},
) => Effect.runPromise(Effect.provide(effect, ActionLoggerLive.pipe(Layer.provide(mockCore(coreOverrides)))));

const runExit = <A, E>(
	effect: Effect.Effect<A, E, ActionLogger>,
	coreOverrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {},
) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, ActionLoggerLive.pipe(Layer.provide(mockCore(coreOverrides))))));

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
	const runWithLogger = <A>(
		effect: Effect.Effect<A>,
		coreOverrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {},
	) => Effect.runPromise(Effect.provide(effect, Layer.provide(ActionLoggerLayer, mockCore(coreOverrides))));

	it("always writes to core.debug", async () => {
		const debug = vi.fn();
		await runWithLogger(Effect.log("hello"), { debug });
		expect(debug).toHaveBeenCalledWith("hello");
	});

	it("at info level, does not emit info-level log to core.info", async () => {
		const info = vi.fn();
		await runWithLogger(Effect.log("hello"), { info });
		expect(info).not.toHaveBeenCalled();
	});

	it("at info level, emits warnings to core.warning", async () => {
		const warning = vi.fn();
		await runWithLogger(Effect.logWarning("warn msg"), { warning });
		expect(warning).toHaveBeenCalledWith("warn msg");
	});

	it("at info level, emits errors to core.error", async () => {
		const error = vi.fn();
		await runWithLogger(Effect.logError("err msg"), { error });
		expect(error).toHaveBeenCalledWith("err msg");
	});

	it("at debug level, emits info-level log to core.info", async () => {
		const info = vi.fn();
		await runWithLogger(setLogLevel("debug").pipe(Effect.flatMap(() => Effect.log("debug msg"))), { info });
		expect(info).toHaveBeenCalledWith("debug msg");
	});

	it("at verbose level, emits info-level log to core.info", async () => {
		const info = vi.fn();
		await runWithLogger(setLogLevel("verbose").pipe(Effect.flatMap(() => Effect.log("verbose msg"))), { info });
		expect(info).toHaveBeenCalledWith("verbose msg");
	});

	it("formats non-string messages as JSON", async () => {
		const debug = vi.fn();
		await runWithLogger(setLogLevel("debug").pipe(Effect.flatMap(() => Effect.log({ key: "value" }))), { debug });
		expect(debug).toHaveBeenCalledWith('{"key":"value"}');
	});
});

describe("ActionLoggerLive", () => {
	describe("group", () => {
		it("wraps effect in startGroup/endGroup", async () => {
			const startGroup = vi.fn();
			const endGroup = vi.fn();
			await run(
				Effect.flatMap(ActionLogger, (svc) => svc.group("my group", Effect.succeed("ok"))),
				{ startGroup, endGroup },
			);
			expect(startGroup).toHaveBeenCalledWith("my group");
			expect(endGroup).toHaveBeenCalled();
		});

		it("calls endGroup even on failure", async () => {
			const startGroup = vi.fn();
			const endGroup = vi.fn();
			await runExit(
				Effect.flatMap(ActionLogger, (svc) => svc.group("fail group", Effect.fail("boom"))),
				{ startGroup, endGroup },
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
					ActionLoggerLive.pipe(Layer.provide(mockCore())),
				),
			);
			expect(result).toBe(42);
		});

		it("at info level, buffers and discards on success", async () => {
			const result = await run(Effect.flatMap(ActionLogger, (svc) => svc.withBuffer("test", Effect.succeed("ok"))));
			expect(result).toBe("ok");
		});

		it("at info level, flushes buffer on failure", async () => {
			const info = vi.fn();
			const exit = await runExit(
				Effect.flatMap(ActionLogger, (svc) =>
					svc.withBuffer("fail-op", Effect.log("buffered line").pipe(Effect.flatMap(() => Effect.fail("boom")))),
				),
				{ info },
			);
			expect(exit._tag).toBe("Failure");
			const infoCalls = info.mock.calls.map((c: unknown[]) => String(c[0]));
			expect(infoCalls.some((c) => c.includes("Buffered output"))).toBe(true);
		});
	});

	describe("annotationError", () => {
		it("emits error annotation without properties", async () => {
			const error = vi.fn();
			await run(
				Effect.flatMap(ActionLogger, (svc) => svc.annotationError("test error")),
				{ error },
			);
			expect(error).toHaveBeenCalledWith("test error");
		});

		it("emits error annotation with properties", async () => {
			const error = vi.fn();
			const props = { file: "test.ts", startLine: 10 };
			await run(
				Effect.flatMap(ActionLogger, (svc) => svc.annotationError("test error", props)),
				{ error },
			);
			expect(error).toHaveBeenCalledWith("test error", props);
		});
	});

	describe("annotationWarning", () => {
		it("emits warning annotation", async () => {
			const warning = vi.fn();
			await run(
				Effect.flatMap(ActionLogger, (svc) => svc.annotationWarning("test warning")),
				{ warning },
			);
			expect(warning).toHaveBeenCalledWith("test warning");
		});

		it("emits warning annotation with properties", async () => {
			const warning = vi.fn();
			const props = { file: "test.ts", startLine: 5 };
			await run(
				Effect.flatMap(ActionLogger, (svc) => svc.annotationWarning("test warning", props)),
				{ warning },
			);
			expect(warning).toHaveBeenCalledWith("test warning", props);
		});
	});

	describe("annotationNotice", () => {
		it("emits notice annotation", async () => {
			const notice = vi.fn();
			await run(
				Effect.flatMap(ActionLogger, (svc) => svc.annotationNotice("test notice")),
				{ notice },
			);
			expect(notice).toHaveBeenCalledWith("test notice");
		});

		it("emits notice annotation with properties", async () => {
			const notice = vi.fn();
			const props = { file: "test.ts", startLine: 1 };
			await run(
				Effect.flatMap(ActionLogger, (svc) => svc.annotationNotice("test notice", props)),
				{ notice },
			);
			expect(notice).toHaveBeenCalledWith("test notice", props);
		});
	});
});
