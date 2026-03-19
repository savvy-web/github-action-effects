import type { Context } from "effect";
import { Effect, Layer } from "effect";
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

/** Build a platform layer from a mock core (only ActionsCore is needed for OTel tests). */
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

describe("Action.run OTel integration", () => {
	it("defaults to auto mode with no OTel inputs (no-op)", async () => {
		const setFailed = vi.fn();
		await Action.run(Effect.void, { platform: mockPlatform({ setFailed }) });

		expect(setFailed).not.toHaveBeenCalled();
	});

	it("disabled mode runs without OTel even if endpoint is set", async () => {
		const setFailed = vi.fn();
		const getInput = vi.fn().mockImplementation((name: string) => {
			if (name === "otel-enabled") return "disabled";
			if (name === "otel-endpoint") return "http://localhost:4317";
			return "";
		});

		await Action.run(Effect.void, { platform: mockPlatform({ setFailed, getInput }) });

		expect(setFailed).not.toHaveBeenCalled();
	});

	it("enabled mode without endpoint falls back gracefully", async () => {
		const setFailed = vi.fn();
		const getInput = vi.fn().mockImplementation((name: string) => {
			if (name === "otel-enabled") return "enabled";
			return "";
		});

		await Action.run(Effect.void, { platform: mockPlatform({ setFailed, getInput }) });

		expect(setFailed).not.toHaveBeenCalled();
	});
});
