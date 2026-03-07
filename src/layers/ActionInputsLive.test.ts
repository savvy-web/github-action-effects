import { getBooleanInput, getInput, getMultilineInput, setSecret } from "@actions/core";
import { Effect, Option, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ActionInputs } from "../services/ActionInputs.js";
import { ActionInputsLive } from "./ActionInputsLive.js";

vi.mock("@actions/core", () => ({
	getInput: vi.fn(),
	getMultilineInput: vi.fn(),
	getBooleanInput: vi.fn(),
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

	describe("getMultiline", () => {
		it("reads and validates multiline input", async () => {
			vi.mocked(getMultilineInput).mockReturnValue(["foo", "bar", "baz"]);
			const result = await run(Effect.flatMap(ActionInputs, (svc) => svc.getMultiline("deps", Schema.String)));
			expect(result).toEqual(["foo", "bar", "baz"]);
			expect(getMultilineInput).toHaveBeenCalledWith("deps", { required: true });
		});

		it("filters blank lines and comments", async () => {
			vi.mocked(getMultilineInput).mockReturnValue(["foo", "", "# comment", "bar"]);
			const result = await run(Effect.flatMap(ActionInputs, (svc) => svc.getMultiline("deps", Schema.String)));
			expect(result).toEqual(["foo", "bar"]);
		});

		it("trims whitespace from each line", async () => {
			vi.mocked(getMultilineInput).mockReturnValue(["  foo  ", "  bar  "]);
			const result = await run(Effect.flatMap(ActionInputs, (svc) => svc.getMultiline("deps", Schema.String)));
			expect(result).toEqual(["foo", "bar"]);
		});
	});

	describe("getBoolean", () => {
		it("reads a boolean input", async () => {
			vi.mocked(getInput).mockReturnValue("true");
			vi.mocked(getBooleanInput).mockReturnValue(true);
			const result = await run(Effect.flatMap(ActionInputs, (svc) => svc.getBoolean("flag")));
			expect(result).toBe(true);
		});

		it("fails on invalid boolean value", async () => {
			vi.mocked(getInput).mockReturnValue("yes");
			vi.mocked(getBooleanInput).mockImplementation(() => {
				throw new TypeError("not a valid boolean");
			});
			const exit = await runExit(Effect.flatMap(ActionInputs, (svc) => svc.getBoolean("flag")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getBooleanOptional", () => {
		it("reads a boolean when present", async () => {
			vi.mocked(getInput).mockReturnValue("false");
			vi.mocked(getBooleanInput).mockReturnValue(false);
			const result = await run(Effect.flatMap(ActionInputs, (svc) => svc.getBooleanOptional("flag", true)));
			expect(result).toBe(false);
		});

		it("returns default when empty", async () => {
			vi.mocked(getInput).mockReturnValue("");
			const result = await run(Effect.flatMap(ActionInputs, (svc) => svc.getBooleanOptional("flag", true)));
			expect(result).toBe(true);
		});
	});
});
