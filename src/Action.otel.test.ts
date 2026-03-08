import * as core from "@actions/core";
import { Effect } from "effect";
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

describe("Action.run OTel integration", () => {
	it("defaults to auto mode with no OTel inputs (no-op)", async () => {
		await Action.run(Effect.void);

		expect(core.setFailed).not.toHaveBeenCalled();
	});

	it("disabled mode runs without OTel even if endpoint is set", async () => {
		vi.mocked(core.getInput).mockImplementation((name) => {
			if (name === "otel-enabled") return "disabled";
			if (name === "otel-endpoint") return "http://localhost:4317";
			return "";
		});

		await Action.run(Effect.void);

		expect(core.setFailed).not.toHaveBeenCalled();
	});

	it("enabled mode without endpoint falls back gracefully", async () => {
		vi.mocked(core.getInput).mockImplementation((name) => {
			if (name === "otel-enabled") return "enabled";
			return "";
		});

		await Action.run(Effect.void);

		expect(core.setFailed).not.toHaveBeenCalled();
	});
});
