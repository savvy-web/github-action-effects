import { Effect, Layer, LogLevel, Logger } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionsLogger } from "./ActionsLogger.js";

const ActionsLoggerLayer = Layer.merge(
	Logger.replace(Logger.defaultLogger, ActionsLogger),
	Logger.minimumLogLevel(LogLevel.Trace),
);

const withActionsLogger = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.runPromise(Effect.provide(effect, ActionsLoggerLayer));

describe("ActionsLogger", () => {
	let writeSpy: ReturnType<typeof vi.spyOn>;
	let captured: string[];

	beforeEach(() => {
		captured = [];
		writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			captured.push(String(chunk));
			return true;
		});
	});

	afterEach(() => {
		writeSpy.mockRestore();
	});

	it("Effect.logDebug emits ::debug:: command", async () => {
		await withActionsLogger(Effect.logDebug("msg"));
		expect(captured.join("")).toContain("::debug::msg");
	});

	it("Effect.logInfo emits plain text (no prefix)", async () => {
		await withActionsLogger(Effect.logInfo("msg"));
		const output = captured.join("");
		expect(output).toContain("msg");
		expect(output).not.toContain("::");
	});

	it("Effect.logWarning emits ::warning:: command", async () => {
		await withActionsLogger(Effect.logWarning("msg"));
		expect(captured.join("")).toContain("::warning::msg");
	});

	it("Effect.logError emits ::error:: command", async () => {
		await withActionsLogger(Effect.logError("msg"));
		expect(captured.join("")).toContain("::error::msg");
	});

	it("Effect.logError with file and line annotations includes properties", async () => {
		await withActionsLogger(Effect.logError("msg").pipe(Effect.annotateLogs({ file: "a.ts", line: "1" })));
		expect(captured.join("")).toContain("::error file=a.ts,line=1::msg");
	});

	it("messages with special chars are properly escaped", async () => {
		await withActionsLogger(Effect.logDebug("50% done\nend"));
		expect(captured.join("")).toContain("::debug::50%25 done%0Aend");
	});
});
