import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Action } from "./Action.js";
import { ActionInputError } from "./errors/ActionInputError.js";
import { ActionInputsTest } from "./layers/ActionInputsTest.js";
import type { ActionInputs } from "./services/ActionInputs.js";

const provide = <A, E>(inputs: Record<string, string>, effect: Effect.Effect<A, E, ActionInputs>) =>
	Effect.provide(effect, ActionInputsTest.layer(inputs));

const run = <A, E>(inputs: Record<string, string>, effect: Effect.Effect<A, E, ActionInputs>) =>
	Effect.runPromise(provide(inputs, effect));

const runExit = <A, E>(inputs: Record<string, string>, effect: Effect.Effect<A, E, ActionInputs>) =>
	Effect.runPromise(Effect.exit(provide(inputs, effect)));

describe("Action.parseInputs", () => {
	it("reads multiple inputs at once", async () => {
		const result = await run(
			{ "app-id": "12345", branch: "main" },
			Action.parseInputs({
				"app-id": { schema: Schema.String, required: true },
				branch: { schema: Schema.String, required: true },
			}),
		);
		expect(result).toEqual({ "app-id": "12345", branch: "main" });
	});

	it("uses default values for missing optional inputs", async () => {
		const result = await run(
			{ "app-id": "12345" },
			Action.parseInputs({
				"app-id": { schema: Schema.String, required: true },
				branch: { schema: Schema.String, default: "develop" },
			}),
		);
		expect(result).toEqual({ "app-id": "12345", branch: "develop" });
	});

	it("fails on missing required input", async () => {
		const exit = await runExit(
			{},
			Action.parseInputs({
				"app-id": { schema: Schema.String, required: true },
			}),
		);
		expect(exit._tag).toBe("Failure");
	});

	it("supports cross-validation", async () => {
		const exit = await runExit(
			{ a: "false", b: "false" },
			Action.parseInputs(
				{
					a: { schema: Schema.String },
					b: { schema: Schema.String },
				},
				(parsed) =>
					parsed.a === "false" && parsed.b === "false"
						? Effect.fail(
								new ActionInputError({
									inputName: "cross-validation",
									reason: "At least one option must be enabled",
									rawValue: undefined,
								}),
							)
						: Effect.succeed(parsed),
			),
		);
		expect(exit._tag).toBe("Failure");
	});

	it("reads JSON inputs with json flag", async () => {
		const result = await run(
			{ config: JSON.stringify({ port: 3000 }) },
			Action.parseInputs({
				config: { schema: Schema.Struct({ port: Schema.Number }), json: true },
			}),
		);
		expect(result).toEqual({ config: { port: 3000 } });
	});

	it("reads multiline inputs with multiline flag", async () => {
		const result = await run(
			{ deps: "foo\nbar\nbaz" },
			Action.parseInputs({
				deps: { schema: Schema.String, multiline: true },
			}),
		);
		expect(result).toEqual({ deps: ["foo", "bar", "baz"] });
	});

	it("reads secret inputs with secret flag", async () => {
		const result = await run(
			{ token: "ghp_abc123" },
			Action.parseInputs({
				token: { schema: Schema.String, secret: true },
			}),
		);
		expect(result).toEqual({ token: "ghp_abc123" });
	});

	it("passes cross-validation on valid inputs", async () => {
		const result = await run(
			{ a: "true", b: "false" },
			Action.parseInputs(
				{
					a: { schema: Schema.String },
					b: { schema: Schema.String },
				},
				(parsed) =>
					parsed.a === "true"
						? Effect.succeed(parsed)
						: Effect.fail(
								new ActionInputError({
									inputName: "cross-validation",
									reason: "a must be true",
									rawValue: undefined,
								}),
							),
			),
		);
		expect(result).toEqual({ a: "true", b: "false" });
	});
});
