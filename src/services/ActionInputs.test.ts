import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ActionInputError } from "../errors/ActionInputError.js";
import { ActionInputsTest } from "../layers/ActionInputsTest.js";
import { ActionInputs } from "./ActionInputs.js";

// -- Shared provide helper (eliminates duplication between run/runExit) --

const provide = <A, E>(inputs: Record<string, string>, effect: Effect.Effect<A, E, ActionInputs>) =>
	Effect.provide(effect, ActionInputsTest.layer(inputs));

const run = <A, E>(inputs: Record<string, string>, effect: Effect.Effect<A, E, ActionInputs>) =>
	Effect.runPromise(provide(inputs, effect));

const runExit = <A, E>(inputs: Record<string, string>, effect: Effect.Effect<A, E, ActionInputs>) =>
	Effect.runPromise(Effect.exit(provide(inputs, effect)));

// -- Service method shorthands (eliminates repeated pipe+flatMap boilerplate) --

const get = <A, I>(name: string, schema: Schema.Schema<A, I, never>) =>
	Effect.flatMap(ActionInputs, (svc) => svc.get(name, schema));

const getOptional = <A, I>(name: string, schema: Schema.Schema<A, I, never>) =>
	Effect.flatMap(ActionInputs, (svc) => svc.getOptional(name, schema));

const getSecret = <A, I>(name: string, schema: Schema.Schema<A, I, never>) =>
	Effect.flatMap(ActionInputs, (svc) => svc.getSecret(name, schema));

const getJson = <A, I>(name: string, schema: Schema.Schema<A, I, never>) =>
	Effect.flatMap(ActionInputs, (svc) => svc.getJson(name, schema));

const getMultiline = <A, I>(name: string, schema: Schema.Schema<A, I, never>) =>
	Effect.flatMap(ActionInputs, (svc) => svc.getMultiline(name, schema));

const getBoolean = (name: string) => Effect.flatMap(ActionInputs, (svc) => svc.getBoolean(name));

const getBooleanOptional = (name: string, defaultValue: boolean) =>
	Effect.flatMap(ActionInputs, (svc) => svc.getBooleanOptional(name, defaultValue));

describe("ActionInputs", () => {
	describe("get", () => {
		it("reads and validates a string input", async () => {
			const result = await run({ name: "hello" }, get("name", Schema.String));
			expect(result).toBe("hello");
		});

		it("fails on missing required input", async () => {
			const exit = await runExit({}, get("name", Schema.String));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getOptional", () => {
		it("returns Some for present input", async () => {
			const result = await run({ name: "hello" }, getOptional("name", Schema.String));
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value).toBe("hello");
			}
		});

		it("returns None for missing input", async () => {
			const result = await run({}, getOptional("name", Schema.String));
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns None for empty string input", async () => {
			const result = await run({ name: "" }, getOptional("name", Schema.String));
			expect(Option.isNone(result)).toBe(true);
		});
	});

	describe("getSecret", () => {
		it("reads a secret input (same as get in test layer)", async () => {
			const result = await run({ token: "ghp_abc123" }, getSecret("token", Schema.String));
			expect(result).toBe("ghp_abc123");
		});

		it("fails on missing secret", async () => {
			const exit = await runExit({}, getSecret("token", Schema.String));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getJson", () => {
		const PackageList = Schema.Array(
			Schema.Struct({
				name: Schema.String,
				version: Schema.String,
			}),
		);

		it("parses and validates JSON input", async () => {
			const jsonInput = JSON.stringify([{ name: "foo", version: "1.0.0" }]);
			const result = await run({ packages: jsonInput }, getJson("packages", PackageList));
			expect(result).toEqual([{ name: "foo", version: "1.0.0" }]);
		});

		it("fails on invalid JSON syntax", async () => {
			const exit = await runExit({ packages: "not json" }, getJson("packages", PackageList));
			expect(exit._tag).toBe("Failure");
		});

		it("fails on valid JSON that doesn't match schema", async () => {
			const exit = await runExit({ packages: JSON.stringify([{ wrong: "shape" }]) }, getJson("packages", PackageList));
			expect(exit._tag).toBe("Failure");
		});

		it("fails on missing JSON input", async () => {
			const exit = await runExit({}, getJson("packages", PackageList));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getMultiline", () => {
		it("splits and validates multiline input", async () => {
			const result = await run({ deps: "foo\nbar\nbaz" }, getMultiline("deps", Schema.String));
			expect(result).toEqual(["foo", "bar", "baz"]);
		});

		it("trims whitespace from each line", async () => {
			const result = await run({ deps: "  foo  \n  bar  " }, getMultiline("deps", Schema.String));
			expect(result).toEqual(["foo", "bar"]);
		});

		it("filters blank lines", async () => {
			const result = await run({ deps: "foo\n\n\nbar" }, getMultiline("deps", Schema.String));
			expect(result).toEqual(["foo", "bar"]);
		});

		it("filters comment lines", async () => {
			const result = await run({ deps: "foo\n# this is a comment\nbar" }, getMultiline("deps", Schema.String));
			expect(result).toEqual(["foo", "bar"]);
		});

		it("validates each item against schema", async () => {
			const exit = await runExit(
				{ deps: "foo\n123\nbar" },
				getMultiline("deps", Schema.String.pipe(Schema.minLength(4))),
			);
			expect(exit._tag).toBe("Failure");
		});

		it("fails on missing input", async () => {
			const exit = await runExit({}, getMultiline("deps", Schema.String));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getBoolean", () => {
		it("reads true", async () => {
			const result = await run({ flag: "true" }, getBoolean("flag"));
			expect(result).toBe(true);
		});

		it("reads false", async () => {
			const result = await run({ flag: "false" }, getBoolean("flag"));
			expect(result).toBe(false);
		});

		it("is case-insensitive", async () => {
			const result = await run({ flag: "True" }, getBoolean("flag"));
			expect(result).toBe(true);
		});

		it("fails on invalid value", async () => {
			const exit = await runExit({ flag: "yes" }, getBoolean("flag"));
			expect(exit._tag).toBe("Failure");
		});

		it("fails on missing input", async () => {
			const exit = await runExit({}, getBoolean("flag"));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getBooleanOptional", () => {
		it("reads true when provided", async () => {
			const result = await run({ flag: "true" }, getBooleanOptional("flag", false));
			expect(result).toBe(true);
		});

		it("returns default when missing", async () => {
			const result = await run({}, getBooleanOptional("flag", true));
			expect(result).toBe(true);
		});

		it("returns default when empty", async () => {
			const result = await run({ flag: "" }, getBooleanOptional("flag", false));
			expect(result).toBe(false);
		});

		it("fails on invalid value", async () => {
			const exit = await runExit({ flag: "maybe" }, getBooleanOptional("flag", true));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("ActionInputError", () => {
		it("is a tagged error", () => {
			const error = new ActionInputError({
				inputName: "test",
				reason: "bad value",
				rawValue: "xyz",
			});
			expect(error._tag).toBe("ActionInputError");
			expect(error.inputName).toBe("test");
			expect(error.rawValue).toBe("xyz");
		});
	});
});
