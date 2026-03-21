import { Config, ConfigError, Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionsConfigProvider } from "./ActionsConfigProvider.js";

// Helper to run a Config (which extends Effect<A, ConfigError>) with ActionsConfigProvider installed
const run = <A>(config: Config.Config<A>) =>
	Effect.runPromise(Effect.withConfigProvider(ActionsConfigProvider)(config));

const runExit = <A>(config: Config.Config<A>) =>
	Effect.runPromiseExit(Effect.withConfigProvider(ActionsConfigProvider)(config));

// Track which env vars we set so we can clean up
let envKeysSet: string[] = [];

const setEnv = (key: string, value: string) => {
	process.env[key] = value;
	envKeysSet.push(key);
};

beforeEach(() => {
	envKeysSet = [];
});

afterEach(() => {
	for (const key of envKeysSet) {
		delete process.env[key];
	}
	envKeysSet = [];
});

describe("ActionsConfigProvider", () => {
	it("reads INPUT_NAME for Config.string('name')", async () => {
		setEnv("INPUT_NAME", "my-action");
		const result = await run(Config.string("name"));
		expect(result).toBe("my-action");
	});

	it("preserves hyphens: Config.string('retry-count') reads INPUT_RETRY-COUNT", async () => {
		setEnv("INPUT_RETRY-COUNT", "five");
		const result = await run(Config.string("retry-count"));
		expect(result).toBe("five");
	});

	it("converts spaces to underscores: Config.string('my input') reads INPUT_MY_INPUT", async () => {
		setEnv("INPUT_MY_INPUT", "spaced-value");
		const result = await run(Config.string("my input"));
		expect(result).toBe("spaced-value");
	});

	it("returns ConfigError when input is missing", async () => {
		delete process.env["INPUT_MISSING-THING"];
		const exit = await runExit(Config.string("missing-thing"));
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure") {
			const cause = exit.cause;
			expect(cause._tag).toBe("Fail");
			if (cause._tag === "Fail") {
				expect(ConfigError.isMissingData(cause.error)).toBe(true);
			}
		}
	});

	it("treats empty string as missing and returns ConfigError", async () => {
		setEnv("INPUT_EMPTY-VAL", "");
		const exit = await runExit(Config.string("empty-val"));
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure") {
			const cause = exit.cause;
			expect(cause._tag).toBe("Fail");
			if (cause._tag === "Fail") {
				expect(ConfigError.isMissingData(cause.error)).toBe(true);
			}
		}
	});

	it("returns fallback when input is missing and Config.withDefault is used", async () => {
		delete process.env.INPUT_OPTIONAL;
		const result = await run(Config.withDefault(Config.string("optional"), "fallback"));
		expect(result).toBe("fallback");
	});

	it("reads and parses Config.boolean('verbose') from INPUT_VERBOSE", async () => {
		setEnv("INPUT_VERBOSE", "true");
		const result = await run(Config.boolean("verbose"));
		expect(result).toBe(true);
	});

	it("reads and parses Config.integer('count') from INPUT_COUNT", async () => {
		setEnv("INPUT_COUNT", "42");
		const result = await run(Config.integer("count"));
		expect(result).toBe(42);
	});
});
