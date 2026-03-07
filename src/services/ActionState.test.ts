import { Effect, Exit, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ActionStateError } from "../errors/ActionStateError.js";
import type { ActionStateTestState } from "../layers/ActionStateTest.js";
import { ActionStateTest } from "../layers/ActionStateTest.js";
import { ActionState } from "./ActionState.js";

// -- Shared provide helper --

const provide = <A, E>(state: ActionStateTestState, effect: Effect.Effect<A, E, ActionState>) =>
	Effect.provide(effect, ActionStateTest.layer(state));

const run = <A, E>(state: ActionStateTestState, effect: Effect.Effect<A, E, ActionState>) =>
	Effect.runPromise(provide(state, effect));

const runExit = <A, E>(state: ActionStateTestState, effect: Effect.Effect<A, E, ActionState>) =>
	Effect.runPromise(Effect.exit(provide(state, effect)));

// -- Service method shorthands --

const get = <A, I>(key: string, schema: Schema.Schema<A, I, never>) =>
	Effect.flatMap(ActionState, (svc) => svc.get(key, schema));

const getOptional = <A, I>(key: string, schema: Schema.Schema<A, I, never>) =>
	Effect.flatMap(ActionState, (svc) => svc.getOptional(key, schema));

describe("ActionState", () => {
	describe("save + get round-trip", () => {
		it("saves and retrieves a struct value", async () => {
			const MySchema = Schema.Struct({
				name: Schema.String,
				count: Schema.Number,
			});

			const state = ActionStateTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* ActionState;
				yield* svc.save("myKey", { name: "hello", count: 42 }, MySchema);
				return yield* svc.get("myKey", MySchema);
			});

			const result = await run(state, program);
			expect(result).toEqual({ name: "hello", count: 42 });
		});
	});

	describe("Schema.DateFromString round-trip", () => {
		it("encodes Date to ISO string and decodes back", async () => {
			const DateSchema = Schema.Date;
			const state = ActionStateTest.empty();
			const testDate = new Date("2024-06-15T10:30:00.000Z");

			const program = Effect.gen(function* () {
				const svc = yield* ActionState;
				yield* svc.save("timestamp", testDate, DateSchema);
				return yield* svc.get("timestamp", DateSchema);
			});

			const result = await run(state, program);
			expect(result).toBeInstanceOf(Date);
			expect(result.toISOString()).toBe("2024-06-15T10:30:00.000Z");

			// Verify the stored value is a JSON-encoded string (not a Date object)
			const stored = state.entries.get("timestamp");
			expect(stored).toBeDefined();
			expect(typeof stored).toBe("string");
		});
	});

	describe("get", () => {
		it("fails on missing state", async () => {
			const state = ActionStateTest.empty();
			const exit = await runExit(state, get("missing", Schema.String));

			expect(exit._tag).toBe("Failure");
			if (Exit.isFailure(exit)) {
				const error = exit.cause.pipe((cause) => {
					if (cause._tag === "Fail") return cause.error;
					return undefined;
				});
				expect(error).toBeInstanceOf(ActionStateError);
				if (error instanceof ActionStateError) {
					expect(error.reason).toContain("phase ordering");
				}
			}
		});

		it("fails on invalid JSON", async () => {
			const state = ActionStateTest.empty();
			state.entries.set("badJson", "not valid json {{{");

			const exit = await runExit(state, get("badJson", Schema.String));
			expect(exit._tag).toBe("Failure");
		});

		it("fails on schema mismatch", async () => {
			const state = ActionStateTest.empty();
			const NumberSchema = Schema.Struct({ value: Schema.Number });
			// Store valid JSON that doesn't match the schema
			state.entries.set("wrongShape", JSON.stringify({ wrong: "shape" }));

			const exit = await runExit(state, get("wrongShape", NumberSchema));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getOptional", () => {
		it("returns None on missing state", async () => {
			const state = ActionStateTest.empty();
			const result = await run(state, getOptional("missing", Schema.String));
			expect(Option.isNone(result)).toBe(true);
		});

		it("returns Some on present state", async () => {
			const state = ActionStateTest.empty();
			const program = Effect.gen(function* () {
				const svc = yield* ActionState;
				yield* svc.save("key", "hello", Schema.String);
				return yield* svc.getOptional("key", Schema.String);
			});

			const result = await run(state, program);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value).toBe("hello");
			}
		});
	});

	describe("complex nested schema", () => {
		it("saves and retrieves complex nested objects", async () => {
			const Address = Schema.Struct({
				street: Schema.String,
				city: Schema.String,
			});

			const Person = Schema.Struct({
				name: Schema.String,
				age: Schema.Number,
				addresses: Schema.Array(Address),
				tags: Schema.Array(Schema.String),
			});

			const state = ActionStateTest.empty();
			const testData = {
				name: "Alice",
				age: 30,
				addresses: [
					{ street: "123 Main St", city: "Springfield" },
					{ street: "456 Oak Ave", city: "Shelbyville" },
				],
				tags: ["admin", "user"],
			};

			const program = Effect.gen(function* () {
				const svc = yield* ActionState;
				yield* svc.save("person", testData, Person);
				return yield* svc.get("person", Person);
			});

			const result = await run(state, program);
			expect(result).toEqual(testData);
		});
	});

	describe("ActionStateError", () => {
		it("is a tagged error", () => {
			const error = new ActionStateError({
				key: "test",
				reason: "bad value",
				rawValue: "xyz",
			});
			expect(error._tag).toBe("ActionStateError");
			expect(error.key).toBe("test");
			expect(error.reason).toBe("bad value");
			expect(error.rawValue).toBe("xyz");
		});
	});
});
