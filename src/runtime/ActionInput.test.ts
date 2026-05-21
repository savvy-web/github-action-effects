import { Config, ConfigError, Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionInput } from "./ActionInput.js";
import { ActionsConfigProvider } from "./ActionsConfigProvider.js";

const run = <A>(config: Config.Config<A>) =>
	Effect.runPromise(Effect.withConfigProvider(ActionsConfigProvider)(config));

const runExit = <A>(config: Config.Config<A>) =>
	Effect.runPromiseExit(Effect.withConfigProvider(ActionsConfigProvider)(config));

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

describe("ActionInput.boolean (YAML 1.2 Core Schema)", () => {
	it("accepts 'true' → true", async () => {
		setEnv("INPUT_FLAG", "true");
		expect(await run(ActionInput.boolean("flag"))).toBe(true);
	});

	it("accepts 'True' → true", async () => {
		setEnv("INPUT_FLAG", "True");
		expect(await run(ActionInput.boolean("flag"))).toBe(true);
	});

	it("accepts 'TRUE' → true", async () => {
		setEnv("INPUT_FLAG", "TRUE");
		expect(await run(ActionInput.boolean("flag"))).toBe(true);
	});

	it("accepts 'false' → false", async () => {
		setEnv("INPUT_FLAG", "false");
		expect(await run(ActionInput.boolean("flag"))).toBe(false);
	});

	it("accepts 'False' → false", async () => {
		setEnv("INPUT_FLAG", "False");
		expect(await run(ActionInput.boolean("flag"))).toBe(false);
	});

	it("accepts 'FALSE' → false", async () => {
		setEnv("INPUT_FLAG", "FALSE");
		expect(await run(ActionInput.boolean("flag"))).toBe(false);
	});

	it("tolerates surrounding whitespace (toolkit trims before the check)", async () => {
		setEnv("INPUT_FLAG", "  true  ");
		expect(await run(ActionInput.boolean("flag"))).toBe(true);
	});

	const expectInvalidData = async (value: string) => {
		setEnv("INPUT_FLAG", value);
		const exit = await runExit(ActionInput.boolean("flag"));
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
			expect(ConfigError.isInvalidData(exit.cause.error)).toBe(true);
		} else {
			throw new Error(`expected a Fail cause, got ${JSON.stringify(exit)}`);
		}
	};

	it("rejects 'yes' with ConfigError.InvalidData", () => expectInvalidData("yes"));
	it("rejects 'on' with ConfigError.InvalidData", () => expectInvalidData("on"));
	it("rejects '1' with ConfigError.InvalidData", () => expectInvalidData("1"));
	it("rejects '0' with ConfigError.InvalidData", () => expectInvalidData("0"));
	it("rejects 'no' with ConfigError.InvalidData", () => expectInvalidData("no"));
	it("rejects 'off' with ConfigError.InvalidData", () => expectInvalidData("off"));
	it("rejects 'tRue' (mixed case) with ConfigError.InvalidData", () => expectInvalidData("tRue"));

	it("error message cites the YAML 1.2 Core Schema list", async () => {
		setEnv("INPUT_FLAG", "yes");
		const exit = await runExit(ActionInput.boolean("flag"));
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
			const message = JSON.stringify(exit.cause.error);
			expect(message).toContain("Input does not meet YAML 1.2");
			expect(message).toContain("Core Schema");
			expect(message).toContain("true | True | TRUE | false | False | FALSE");
		} else {
			throw new Error("expected a Fail cause");
		}
	});

	it("composes with Config.withDefault when input is unset", async () => {
		delete process.env.INPUT_FLAG;
		const result = await run(Config.withDefault(ActionInput.boolean("flag"), false));
		expect(result).toBe(false);
	});
});

describe("ActionInput.multiline", () => {
	it("splits on newlines", async () => {
		setEnv("INPUT_PATHS", "a\nb\nc");
		expect(await run(ActionInput.multiline("paths"))).toEqual(["a", "b", "c"]);
	});

	it("drops empty lines", async () => {
		setEnv("INPUT_PATHS", "a\n\nb\n");
		expect(await run(ActionInput.multiline("paths"))).toEqual(["a", "b"]);
	});

	it("trims each line", async () => {
		setEnv("INPUT_PATHS", "  a  \n b ");
		expect(await run(ActionInput.multiline("paths"))).toEqual(["a", "b"]);
	});

	it("returns single-element array for single line", async () => {
		setEnv("INPUT_PATHS", "solo");
		expect(await run(ActionInput.multiline("paths"))).toEqual(["solo"]);
	});

	it("missing input is a ConfigError (not [])", async () => {
		delete process.env.INPUT_PATHS;
		const exit = await runExit(ActionInput.multiline("paths"));
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure" && exit.cause._tag === "Fail") {
			expect(ConfigError.isMissingData(exit.cause.error)).toBe(true);
		} else {
			throw new Error("expected a Fail cause");
		}
	});

	it("composes with Config.withDefault to produce []", async () => {
		delete process.env.INPUT_PATHS;
		const result = await run(Config.withDefault(ActionInput.multiline("paths"), [] as ReadonlyArray<string>));
		expect(result).toEqual([]);
	});
});
