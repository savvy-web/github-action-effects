import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodeState, encodeState } from "./decodeState.js";

const TestSchema = Schema.Struct({
	value: Schema.String,
});

describe("decodeState", () => {
	it("decodes valid JSON with matching schema", async () => {
		const result = await Effect.runPromise(decodeState("key", JSON.stringify({ value: "hello" }), TestSchema));
		expect(result).toEqual({ value: "hello" });
	});

	it("fails on invalid JSON", async () => {
		const exit = await Effect.runPromise(Effect.exit(decodeState("key", "not-json", TestSchema)));
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("fails on schema mismatch", async () => {
		const exit = await Effect.runPromise(Effect.exit(decodeState("key", JSON.stringify({ wrong: 1 }), TestSchema)));
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("includes key in error reason for invalid JSON", async () => {
		const exit = await Effect.runPromise(Effect.exit(decodeState("myKey", "{bad", TestSchema)));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error = exit.cause.toJSON();
			expect(JSON.stringify(error)).toContain("myKey");
		}
	});
});

describe("encodeState", () => {
	it("encodes a valid value to JSON string", async () => {
		const result = await Effect.runPromise(encodeState("key", { value: "hello" }, TestSchema));
		expect(result).toBe(JSON.stringify({ value: "hello" }));
	});

	it("fails when encoding an invalid value", async () => {
		const StrictSchema = Schema.Struct({ n: Schema.Number });
		const exit = await Effect.runPromise(
			Effect.exit(encodeState("key", { n: "not-a-number" } as unknown as { n: number }, StrictSchema)),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});
});
