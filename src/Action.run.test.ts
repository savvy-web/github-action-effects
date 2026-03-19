import { Context, Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Action } from "./Action.js";
import type { ActionsPlatform } from "./layers/ActionsPlatformLive.js";
import { ActionsCore } from "./services/ActionsCore.js";

/** Create a mock ActionsCore layer with optional overrides. */
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
		summary: {
			write: () => Promise.resolve(),
			addRaw: vi.fn().mockReturnThis(),
		},
		...overrides,
	});

/** Build a platform layer from a mock core (only ActionsCore is needed for Action.run tests). */
const mockPlatform = (overrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {}): Layer.Layer<ActionsPlatform> =>
	// biome-ignore lint/suspicious/noExplicitAny: test helper — only ActionsCore matters
	mockCore(overrides) as any;

beforeEach(() => {
	// Clear OTel env vars so resolveOtelConfig doesn't pick them up
	vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "");
	vi.stubEnv("OTEL_EXPORTER_OTLP_PROTOCOL", "");
	vi.stubEnv("OTEL_EXPORTER_OTLP_HEADERS", "");
});

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
});

describe("Action.run", () => {
	it("runs a successful program without calling setFailed", async () => {
		const setFailed = vi.fn();
		await Action.run(Effect.void, { platform: mockPlatform({ setFailed }) });
		expect(setFailed).not.toHaveBeenCalled();
	});

	it("calls setFailed on program failure", async () => {
		const setFailed = vi.fn();
		await Action.run(Effect.fail("something broke"), { platform: mockPlatform({ setFailed }) });
		expect(setFailed).toHaveBeenCalledWith(expect.stringContaining("Action failed"));
	});

	it("accepts additional layers via options", async () => {
		const setFailed = vi.fn();
		class MyService extends Context.Tag("TestMyService")<MyService, { readonly value: string }>() {}
		const MyServiceLive = Layer.succeed(MyService, { value: "hello" });

		const program = Effect.flatMap(MyService, (svc) =>
			Effect.sync(() => {
				expect(svc.value).toBe("hello");
			}),
		);

		await Action.run(program, { layer: MyServiceLive, platform: mockPlatform({ setFailed }) });
		expect(setFailed).not.toHaveBeenCalled();
	});

	it("writes telemetry summary when log level is debug", async () => {
		const setFailed = vi.fn();
		const addRaw = vi.fn().mockReturnThis();
		const write = vi.fn().mockResolvedValue(undefined);
		const getInput = vi.fn().mockImplementation((name: string) => (name === "log-level" ? "debug" : ""));
		const platform = mockPlatform({ setFailed, getInput, summary: { addRaw, write } });

		const program = Effect.void.pipe(Effect.withSpan("test-operation"));

		await Action.run(program, { platform });
		expect(setFailed).not.toHaveBeenCalled();
		expect(addRaw).toHaveBeenCalledWith(expect.stringContaining("test-operation"));
		expect(write).toHaveBeenCalled();
	});

	it("writes telemetry summary on failure when log level is debug", async () => {
		const setFailed = vi.fn();
		const addRaw = vi.fn().mockReturnThis();
		const write = vi.fn().mockResolvedValue(undefined);
		const getInput = vi.fn().mockImplementation((name: string) => (name === "log-level" ? "debug" : ""));
		const platform = mockPlatform({ setFailed, getInput, summary: { addRaw, write } });

		const program = Effect.fail("boom").pipe(Effect.withSpan("failing-operation"));

		await Action.run(program, { platform });
		expect(setFailed).toHaveBeenCalledWith(expect.stringContaining("Action failed"));
		expect(addRaw).toHaveBeenCalledWith(expect.stringContaining("failing-operation"));
		expect(write).toHaveBeenCalled();
	});

	it("skips telemetry summary when log level is not debug", async () => {
		const setFailed = vi.fn();
		const addRaw = vi.fn().mockReturnThis();
		const platform = mockPlatform({ setFailed, summary: { addRaw, write: vi.fn() } });

		const program = Effect.void.pipe(Effect.withSpan("test-operation"));

		await Action.run(program, { platform });
		expect(setFailed).not.toHaveBeenCalled();
		expect(addRaw).not.toHaveBeenCalled();
	});

	it("does not write telemetry summary when no spans are recorded", async () => {
		const setFailed = vi.fn();
		const addRaw = vi.fn().mockReturnThis();
		const getInput = vi.fn().mockImplementation((name: string) => (name === "log-level" ? "debug" : ""));
		const platform = mockPlatform({ setFailed, getInput, summary: { addRaw, write: vi.fn() } });

		await Action.run(Effect.void, { platform });
		expect(setFailed).not.toHaveBeenCalled();
		expect(addRaw).not.toHaveBeenCalled();
	});

	it("flushes buffered log output on failure", async () => {
		const setFailed = vi.fn();
		const info = vi.fn();
		const platform = mockPlatform({
			setFailed,
			info,
			summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn() },
		});

		const program = Effect.gen(function* () {
			yield* Effect.log("diagnostic info before crash");
			yield* Effect.fail("boom");
		});

		await Action.run(program, { platform });
		expect(setFailed).toHaveBeenCalledWith(expect.stringContaining("Action failed"));
		const infoCalls = info.mock.calls.map((c: unknown[]) => c[0]);
		expect(infoCalls.some((c: unknown) => typeof c === "string" && c.includes("diagnostic info before crash"))).toBe(
			true,
		);
		expect(infoCalls.some((c: unknown) => typeof c === "string" && c.includes("Buffered output"))).toBe(true);
	});

	it("discards buffered log output on success", async () => {
		const setFailed = vi.fn();
		const info = vi.fn();
		const platform = mockPlatform({
			setFailed,
			info,
			summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn() },
		});

		const program = Effect.gen(function* () {
			yield* Effect.log("should not appear in info output");
		});

		await Action.run(program, { platform });
		expect(setFailed).not.toHaveBeenCalled();
		const infoCalls = info.mock.calls.map((c: unknown[]) => c[0]);
		expect(infoCalls.some((c: unknown) => typeof c === "string" && c.includes("should not appear"))).toBe(false);
	});
});
