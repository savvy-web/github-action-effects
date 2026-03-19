import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { decodeInput, decodeJsonInput } from "./decodeInput.js";

const TestSchema = Schema.Struct({
	value: Schema.String,
});

describe("decodeInput", () => {
	it("decodes a valid value against a schema", async () => {
		const result = await Effect.runPromise(decodeInput("myInput", "hello", Schema.String));
		expect(result).toBe("hello");
	});

	it("fails with ActionInputError when schema validation fails", async () => {
		const exit = await Effect.runPromise(Effect.exit(decodeInput("myInput", "not-a-number", Schema.NumberFromString)));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error = exit.cause.toJSON();
			expect(JSON.stringify(error)).toContain("myInput");
		}
	});
});

describe("decodeJsonInput", () => {
	it("parses and decodes valid JSON against a schema", async () => {
		const result = await Effect.runPromise(decodeJsonInput("myInput", JSON.stringify({ value: "hello" }), TestSchema));
		expect(result).toEqual({ value: "hello" });
	});

	it("fails with ActionInputError on invalid JSON", async () => {
		const exit = await Effect.runPromise(Effect.exit(decodeJsonInput("myInput", "{bad json", TestSchema)));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error = exit.cause.toJSON();
			expect(JSON.stringify(error)).toContain("myInput");
			expect(JSON.stringify(error)).toContain("not valid JSON");
		}
	});

	it("fails with ActionInputError on schema mismatch after parse", async () => {
		const exit = await Effect.runPromise(
			Effect.exit(decodeJsonInput("myInput", JSON.stringify({ wrong: 1 }), TestSchema)),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error = exit.cause.toJSON();
			expect(JSON.stringify(error)).toContain("myInput");
		}
	});

	it("includes input name and raw value in error for non-Error parse failures", async () => {
		// JSON.parse throws a SyntaxError (an Error subclass) — we verify the reason
		// still includes the name even when the thrown value is not an Error instance
		const exit = await Effect.runPromise(Effect.exit(decodeJsonInput("fieldName", "undefined", TestSchema)));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error = exit.cause.toJSON();
			expect(JSON.stringify(error)).toContain("fieldName");
		}
	});
});
