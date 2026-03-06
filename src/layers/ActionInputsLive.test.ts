import { getInput, setSecret } from "@actions/core";
import { Effect, Option, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ActionInputs } from "../services/ActionInputs.js";
import { ActionInputsLive } from "./ActionInputsLive.js";

vi.mock("@actions/core", () => ({
	getInput: vi.fn(),
	setSecret: vi.fn(),
}));

const run = <A, E>(effect: Effect.Effect<A, E, ActionInputs>) =>
	Effect.runPromise(Effect.provide(effect, ActionInputsLive));

const runExit = <A, E>(effect: Effect.Effect<A, E, ActionInputs>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, ActionInputsLive)));

describe("ActionInputsLive", () => {
	describe("get", () => {
		it("reads and decodes an input", async () => {
			vi.mocked(getInput).mockReturnValue("hello");
			const result = await run(Effect.flatMap(ActionInputs, (svc) => svc.get("name", Schema.String)));
			expect(result).toBe("hello");
			expect(getInput).toHaveBeenCalledWith("name", { required: true });
		});

		it("fails on schema validation error", async () => {
			vi.mocked(getInput).mockReturnValue("not-a-number");
			const exit = await runExit(Effect.flatMap(ActionInputs, (svc) => svc.get("count", Schema.NumberFromString)));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getOptional", () => {
		it("returns Some for present input", async () => {
			vi.mocked(getInput).mockReturnValue("value");
			const result = await run(Effect.flatMap(ActionInputs, (svc) => svc.getOptional("opt", Schema.String)));
			expect(Option.isSome(result)).toBe(true);
		});

		it("returns None for empty input", async () => {
			vi.mocked(getInput).mockReturnValue("");
			const result = await run(Effect.flatMap(ActionInputs, (svc) => svc.getOptional("opt", Schema.String)));
			expect(Option.isNone(result)).toBe(true);
		});
	});

	describe("getSecret", () => {
		it("reads input and marks as secret", async () => {
			vi.mocked(getInput).mockReturnValue("ghp_token123");
			const result = await run(Effect.flatMap(ActionInputs, (svc) => svc.getSecret("token", Schema.String)));
			expect(result).toBe("ghp_token123");
			expect(setSecret).toHaveBeenCalledWith("ghp_token123");
		});
	});

	describe("getJson", () => {
		it("parses and validates JSON input", async () => {
			vi.mocked(getInput).mockReturnValue('{"name":"test"}');
			const MySchema = Schema.Struct({ name: Schema.String });
			const result = await run(Effect.flatMap(ActionInputs, (svc) => svc.getJson("data", MySchema)));
			expect(result).toEqual({ name: "test" });
		});

		it("fails on invalid JSON", async () => {
			vi.mocked(getInput).mockReturnValue("not json");
			const exit = await runExit(Effect.flatMap(ActionInputs, (svc) => svc.getJson("data", Schema.String)));
			expect(exit._tag).toBe("Failure");
		});

		it("fails on valid JSON that doesn't match schema", async () => {
			vi.mocked(getInput).mockReturnValue('{"wrong":"shape"}');
			const MySchema = Schema.Struct({ name: Schema.String });
			const exit = await runExit(Effect.flatMap(ActionInputs, (svc) => svc.getJson("data", MySchema)));
			expect(exit._tag).toBe("Failure");
		});
	});
});
