import type { Context } from "effect";
import { Effect, Layer, Option, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ActionInputs } from "../services/ActionInputs.js";
import { ActionsCore } from "../services/ActionsCore.js";
import { ActionInputsLive } from "./ActionInputsLive.js";

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
	effect: Effect.Effect<A, E, ActionInputs>,
	coreOverrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {},
) => Effect.runPromise(Effect.provide(effect, ActionInputsLive.pipe(Layer.provide(mockCore(coreOverrides)))));

const runExit = <A, E>(
	effect: Effect.Effect<A, E, ActionInputs>,
	coreOverrides: Partial<Context.Tag.Service<typeof ActionsCore>> = {},
) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, ActionInputsLive.pipe(Layer.provide(mockCore(coreOverrides))))));

describe("ActionInputsLive", () => {
	describe("get", () => {
		it("reads and decodes an input", async () => {
			const getInput = vi.fn().mockReturnValue("hello");
			const result = await run(
				Effect.flatMap(ActionInputs, (svc) => svc.get("name", Schema.String)),
				{ getInput },
			);
			expect(result).toBe("hello");
			expect(getInput).toHaveBeenCalledWith("name", { required: true });
		});

		it("fails on schema validation error", async () => {
			const getInput = vi.fn().mockReturnValue("not-a-number");
			const exit = await runExit(
				Effect.flatMap(ActionInputs, (svc) => svc.get("count", Schema.NumberFromString)),
				{ getInput },
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getOptional", () => {
		it("returns Some for present input", async () => {
			const getInput = vi.fn().mockReturnValue("value");
			const result = await run(
				Effect.flatMap(ActionInputs, (svc) => svc.getOptional("opt", Schema.String)),
				{
					getInput,
				},
			);
			expect(Option.isSome(result)).toBe(true);
		});

		it("returns None for empty input", async () => {
			const getInput = vi.fn().mockReturnValue("");
			const result = await run(
				Effect.flatMap(ActionInputs, (svc) => svc.getOptional("opt", Schema.String)),
				{
					getInput,
				},
			);
			expect(Option.isNone(result)).toBe(true);
		});
	});

	describe("getSecret", () => {
		it("reads input and marks as secret", async () => {
			const getInput = vi.fn().mockReturnValue("ghp_token123");
			const setSecret = vi.fn();
			const result = await run(
				Effect.flatMap(ActionInputs, (svc) => svc.getSecret("token", Schema.String)),
				{
					getInput,
					setSecret,
				},
			);
			expect(result).toBe("ghp_token123");
			expect(setSecret).toHaveBeenCalledWith("ghp_token123");
		});
	});

	describe("getJson", () => {
		it("parses and validates JSON input", async () => {
			const getInput = vi.fn().mockReturnValue('{"name":"test"}');
			const MySchema = Schema.Struct({ name: Schema.String });
			const result = await run(
				Effect.flatMap(ActionInputs, (svc) => svc.getJson("data", MySchema)),
				{ getInput },
			);
			expect(result).toEqual({ name: "test" });
		});

		it("fails on invalid JSON", async () => {
			const getInput = vi.fn().mockReturnValue("not json");
			const exit = await runExit(
				Effect.flatMap(ActionInputs, (svc) => svc.getJson("data", Schema.String)),
				{
					getInput,
				},
			);
			expect(exit._tag).toBe("Failure");
		});

		it("fails on valid JSON that doesn't match schema", async () => {
			const getInput = vi.fn().mockReturnValue('{"wrong":"shape"}');
			const MySchema = Schema.Struct({ name: Schema.String });
			const exit = await runExit(
				Effect.flatMap(ActionInputs, (svc) => svc.getJson("data", MySchema)),
				{ getInput },
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getMultiline", () => {
		it("reads and validates multiline input", async () => {
			const getMultilineInput = vi.fn().mockReturnValue(["foo", "bar", "baz"]);
			const result = await run(
				Effect.flatMap(ActionInputs, (svc) => svc.getMultiline("deps", Schema.String)),
				{
					getMultilineInput,
				},
			);
			expect(result).toEqual(["foo", "bar", "baz"]);
			expect(getMultilineInput).toHaveBeenCalledWith("deps", { required: true });
		});

		it("filters blank lines and comments", async () => {
			const getMultilineInput = vi.fn().mockReturnValue(["foo", "", "# comment", "bar"]);
			const result = await run(
				Effect.flatMap(ActionInputs, (svc) => svc.getMultiline("deps", Schema.String)),
				{
					getMultilineInput,
				},
			);
			expect(result).toEqual(["foo", "bar"]);
		});

		it("trims whitespace from each line", async () => {
			const getMultilineInput = vi.fn().mockReturnValue(["  foo  ", "  bar  "]);
			const result = await run(
				Effect.flatMap(ActionInputs, (svc) => svc.getMultiline("deps", Schema.String)),
				{
					getMultilineInput,
				},
			);
			expect(result).toEqual(["foo", "bar"]);
		});
	});

	describe("getBoolean", () => {
		it("reads a boolean input", async () => {
			const getInput = vi.fn().mockReturnValue("true");
			const result = await run(
				Effect.flatMap(ActionInputs, (svc) => svc.getBoolean("flag")),
				{ getInput },
			);
			expect(result).toBe(true);
		});

		it("fails on invalid boolean value", async () => {
			const getInput = vi.fn().mockReturnValue("yes");
			const exit = await runExit(
				Effect.flatMap(ActionInputs, (svc) => svc.getBoolean("flag")),
				{ getInput },
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getBooleanOptional", () => {
		it("reads a boolean when present", async () => {
			const getInput = vi.fn().mockReturnValue("false");
			const result = await run(
				Effect.flatMap(ActionInputs, (svc) => svc.getBooleanOptional("flag", true)),
				{
					getInput,
				},
			);
			expect(result).toBe(false);
		});

		it("returns default when empty", async () => {
			const getInput = vi.fn().mockReturnValue("");
			const result = await run(
				Effect.flatMap(ActionInputs, (svc) => svc.getBooleanOptional("flag", true)),
				{
					getInput,
				},
			);
			expect(result).toBe(true);
		});
	});
});
