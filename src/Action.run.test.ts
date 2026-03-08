import * as core from "@actions/core";
import { Context, Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Action } from "./Action.js";

vi.mock("@actions/core", () => ({
	getInput: vi.fn(() => ""),
	getMultilineInput: vi.fn(() => []),
	getBooleanInput: vi.fn(() => false),
	setSecret: vi.fn(),
	setOutput: vi.fn(),
	setFailed: vi.fn(),
	exportVariable: vi.fn(),
	addPath: vi.fn(),
	info: vi.fn(),
	debug: vi.fn(),
	warning: vi.fn(),
	error: vi.fn(),
	notice: vi.fn(),
	startGroup: vi.fn(),
	endGroup: vi.fn(),
	summary: {
		addRaw: vi.fn().mockReturnThis(),
		write: vi.fn().mockResolvedValue(undefined),
	},
}));

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
		await Action.run(Effect.void);
		expect(core.setFailed).not.toHaveBeenCalled();
	});

	it("calls setFailed on program failure", async () => {
		await Action.run(Effect.fail("something broke"));
		expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("Action failed"));
	});

	it("accepts additional layers", async () => {
		interface MyService {
			readonly value: string;
		}
		const MyService = Context.GenericTag<MyService>("TestMyService");
		const MyServiceLive = Layer.succeed(MyService, { value: "hello" });

		const program = Effect.flatMap(MyService, (svc) =>
			Effect.sync(() => {
				expect(svc.value).toBe("hello");
			}),
		);

		await Action.run(program, MyServiceLive);
		expect(core.setFailed).not.toHaveBeenCalled();
	});

	it("writes telemetry summary when spans are recorded", async () => {
		const program = Effect.void.pipe(Effect.withSpan("test-operation"));

		await Action.run(program);
		expect(core.setFailed).not.toHaveBeenCalled();
		expect(core.summary.addRaw).toHaveBeenCalledWith(expect.stringContaining("test-operation"));
		expect(core.summary.write).toHaveBeenCalled();
	});

	it("writes telemetry summary even when the program fails", async () => {
		const program = Effect.fail("boom").pipe(Effect.withSpan("failing-operation"));

		await Action.run(program);
		expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining("Action failed"));
		expect(core.summary.addRaw).toHaveBeenCalledWith(expect.stringContaining("failing-operation"));
		expect(core.summary.write).toHaveBeenCalled();
	});

	it("does not write telemetry summary when no spans are recorded", async () => {
		await Action.run(Effect.void);
		expect(core.setFailed).not.toHaveBeenCalled();
		expect(core.summary.addRaw).not.toHaveBeenCalled();
	});
});
