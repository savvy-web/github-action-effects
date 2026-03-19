import type { Context } from "effect";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ActionOutputs } from "../services/ActionOutputs.js";
import { ActionsCore } from "../services/ActionsCore.js";
import { ActionOutputsLive } from "./ActionOutputsLive.js";

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
	effect: Effect.Effect<A, E, ActionOutputs>,
	coreOverrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {},
) => Effect.runPromise(Effect.provide(effect, ActionOutputsLive.pipe(Layer.provide(mockCore(coreOverrides)))));

const runExit = <A, E>(
	effect: Effect.Effect<A, E, ActionOutputs>,
	coreOverrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {},
) =>
	Effect.runPromise(
		Effect.exit(Effect.provide(effect, ActionOutputsLive.pipe(Layer.provide(mockCore(coreOverrides))))),
	);

describe("ActionOutputsLive", () => {
	describe("set", () => {
		it("calls core.setOutput", async () => {
			const setOutput = vi.fn();
			await run(
				Effect.flatMap(ActionOutputs, (svc) => svc.set("result", "success")),
				{ setOutput },
			);
			expect(setOutput).toHaveBeenCalledWith("result", "success");
		});
	});

	describe("setJson", () => {
		it("serializes and sets JSON output", async () => {
			const setOutput = vi.fn();
			const MySchema = Schema.Struct({ count: Schema.Number });
			await run(
				Effect.flatMap(ActionOutputs, (svc) => svc.setJson("data", { count: 42 }, MySchema)),
				{ setOutput },
			);
			expect(setOutput).toHaveBeenCalled();
		});

		it("fails on schema validation error", async () => {
			const MySchema = Schema.Struct({ count: Schema.Number });
			const exit = await runExit(
				Effect.flatMap(ActionOutputs, (svc) => svc.setJson("data", { count: "bad" as unknown as number }, MySchema)),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("summary", () => {
		it("writes to step summary", async () => {
			const addRaw = vi.fn().mockReturnValue({ write: vi.fn().mockResolvedValue(undefined) });
			await run(
				Effect.flatMap(ActionOutputs, (svc) => svc.summary("## Report")),
				{
					summary: { addRaw, write: () => Promise.resolve() },
				},
			);
			expect(addRaw).toHaveBeenCalledWith("## Report");
		});
	});

	describe("exportVariable", () => {
		it("calls core.exportVariable", async () => {
			const exportVariable = vi.fn();
			await run(
				Effect.flatMap(ActionOutputs, (svc) => svc.exportVariable("MY_VAR", "val")),
				{ exportVariable },
			);
			expect(exportVariable).toHaveBeenCalledWith("MY_VAR", "val");
		});
	});

	describe("addPath", () => {
		it("calls core.addPath", async () => {
			const addPath = vi.fn();
			await run(
				Effect.flatMap(ActionOutputs, (svc) => svc.addPath("/usr/local/bin")),
				{ addPath },
			);
			expect(addPath).toHaveBeenCalledWith("/usr/local/bin");
		});
	});

	describe("setFailed", () => {
		it("calls core.setFailed", async () => {
			const setFailed = vi.fn();
			await run(
				Effect.flatMap(ActionOutputs, (svc) => svc.setFailed("Build failed")),
				{ setFailed },
			);
			expect(setFailed).toHaveBeenCalledWith("Build failed");
		});
	});

	describe("setSecret", () => {
		it("calls core.setSecret", async () => {
			const setSecret = vi.fn();
			await run(
				Effect.flatMap(ActionOutputs, (svc) => svc.setSecret("ghs_token123")),
				{ setSecret },
			);
			expect(setSecret).toHaveBeenCalledWith("ghs_token123");
		});
	});
});
