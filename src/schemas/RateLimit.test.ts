import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { RateLimitStatus } from "./RateLimit.js";

describe("RateLimitStatus", () => {
	it("decodes valid rate limit status", () => {
		const input = { limit: 5000, remaining: 4999, reset: 1700000000, used: 1 };
		const result = Schema.decodeUnknownSync(RateLimitStatus)(input);
		expect(result).toEqual(input);
	});

	it("rejects non-numeric values", () => {
		expect(() =>
			Schema.decodeUnknownSync(RateLimitStatus)({
				limit: "5000",
				remaining: 4999,
				reset: 1700000000,
				used: 1,
			}),
		).toThrow();
	});

	it("rejects missing fields", () => {
		expect(() => Schema.decodeUnknownSync(RateLimitStatus)({ limit: 5000 })).toThrow();
	});
});
