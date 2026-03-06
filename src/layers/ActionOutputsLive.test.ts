import { addPath, exportVariable, setOutput, summary } from "@actions/core";
import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ActionOutputs } from "../services/ActionOutputs.js";
import { ActionOutputsLive } from "./ActionOutputsLive.js";

vi.mock("@actions/core", () => ({
	setOutput: vi.fn(),
	exportVariable: vi.fn(),
	addPath: vi.fn(),
	summary: {
		addRaw: vi.fn().mockReturnValue({ write: vi.fn().mockResolvedValue(undefined) }),
	},
}));

const run = <A, E>(effect: Effect.Effect<A, E, ActionOutputs>) =>
	Effect.runPromise(Effect.provide(effect, ActionOutputsLive));

describe("ActionOutputsLive", () => {
	describe("set", () => {
		it("calls core.setOutput", async () => {
			await run(Effect.flatMap(ActionOutputs, (svc) => svc.set("result", "success")));
			expect(setOutput).toHaveBeenCalledWith("result", "success");
		});
	});

	describe("setJson", () => {
		it("serializes and sets JSON output", async () => {
			const MySchema = Schema.Struct({ count: Schema.Number });
			await run(Effect.flatMap(ActionOutputs, (svc) => svc.setJson("data", { count: 42 }, MySchema)));
			expect(setOutput).toHaveBeenCalled();
		});

		it("fails on schema validation error", async () => {
			const MySchema = Schema.Struct({ count: Schema.Number });
			const exit = await Effect.runPromise(
				Effect.exit(
					Effect.provide(
						Effect.flatMap(ActionOutputs, (svc) =>
							svc.setJson("data", { count: "bad" as unknown as number }, MySchema),
						),
						ActionOutputsLive,
					),
				),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("summary", () => {
		it("writes to step summary", async () => {
			await run(Effect.flatMap(ActionOutputs, (svc) => svc.summary("## Report")));
			expect(summary.addRaw).toHaveBeenCalledWith("## Report");
		});
	});

	describe("exportVariable", () => {
		it("calls core.exportVariable", async () => {
			await run(Effect.flatMap(ActionOutputs, (svc) => svc.exportVariable("MY_VAR", "val")));
			expect(exportVariable).toHaveBeenCalledWith("MY_VAR", "val");
		});
	});

	describe("addPath", () => {
		it("calls core.addPath", async () => {
			await run(Effect.flatMap(ActionOutputs, (svc) => svc.addPath("/usr/local/bin")));
			expect(addPath).toHaveBeenCalledWith("/usr/local/bin");
		});
	});
});
