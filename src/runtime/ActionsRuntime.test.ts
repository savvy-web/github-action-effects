import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Config, Effect, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionLogger } from "../services/ActionLogger.js";
import { ActionOutputs } from "../services/ActionOutputs.js";
import { ActionState } from "../services/ActionState.js";
import { ActionsRuntime } from "./ActionsRuntime.js";

// -- Helpers --

const run = <A>(effect: Effect.Effect<A, unknown, never>) => Effect.runPromise(effect);

const runWithDefault = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
	// Cast is safe: ActionsRuntime.Default satisfies all R requirements in these tests
	Effect.runPromise(Effect.provide(effect as unknown as Effect.Effect<A, E, never>, ActionsRuntime.Default));

// Temp file management

let tempFiles: string[] = [];

const makeTempFile = (): string => {
	const filePath = path.join(os.tmpdir(), `actions-runtime-test-${Math.random().toString(36).slice(2)}`);
	fs.writeFileSync(filePath, "");
	tempFiles.push(filePath);
	return filePath;
};

// Env var cleanup

let envKeysSet: string[] = [];

const setEnv = (key: string, value: string) => {
	process.env[key] = value;
	envKeysSet.push(key);
};

const deleteEnv = (key: string) => {
	delete process.env[key];
	envKeysSet = envKeysSet.filter((k) => k !== key);
};

// -- Test Suite --

describe("ActionsRuntime", () => {
	let outputFile: string;
	let stateFile: string;
	let summaryFile: string;
	let envFile: string;
	let pathFile: string;
	let writeSpy: ReturnType<typeof vi.spyOn>;
	let captured: string[];

	beforeEach(() => {
		outputFile = makeTempFile();
		stateFile = makeTempFile();
		summaryFile = makeTempFile();
		envFile = makeTempFile();
		pathFile = makeTempFile();

		setEnv("GITHUB_OUTPUT", outputFile);
		setEnv("GITHUB_STATE", stateFile);
		setEnv("GITHUB_STEP_SUMMARY", summaryFile);
		setEnv("GITHUB_ENV", envFile);
		setEnv("GITHUB_PATH", pathFile);
		setEnv("GITHUB_REPOSITORY", "owner/repo");

		captured = [];
		writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			captured.push(String(chunk));
			return true;
		});
	});

	afterEach(() => {
		writeSpy.mockRestore();

		for (const key of [...envKeysSet]) {
			delete process.env[key];
		}
		envKeysSet = [];

		for (const f of tempFiles) {
			try {
				fs.unlinkSync(f);
			} catch {
				// ignore cleanup errors
			}
		}
		tempFiles = [];
	});

	describe("ConfigProvider integration", () => {
		it("reads INPUT_NAME when Config.string('name') is used", async () => {
			setEnv("INPUT_NAME", "my-action");

			const program = Config.string("name");
			const result = await runWithDefault(program);

			expect(result).toBe("my-action");

			deleteEnv("INPUT_NAME");
		});

		it("returns an error when the input env var is missing", async () => {
			deleteEnv("INPUT_NAME");

			const program = Config.string("name");
			const exit = await run(Effect.exit(Effect.provide(program, ActionsRuntime.Default)));

			expect(exit._tag).toBe("Failure");
		});
	});

	describe("Logger integration", () => {
		it("Effect.log emits plain text to stdout (Info level)", async () => {
			const program = Effect.log("hello from runtime");
			await runWithDefault(program);

			expect(captured.join("")).toContain("hello from runtime");
		});

		it("Effect.logDebug emits ::debug:: workflow command when minimum log level is All", async () => {
			const { Logger: EffectLogger, LogLevel } = await import("effect");
			const program = Effect.logDebug("debug message").pipe(EffectLogger.withMinimumLogLevel(LogLevel.All));
			await runWithDefault(program);

			expect(captured.join("")).toContain("::debug::debug message");
		});

		it("Effect.logWarning emits ::warning:: workflow command", async () => {
			const program = Effect.logWarning("warn message");
			await runWithDefault(program);

			expect(captured.join("")).toContain("::warning::warn message");
		});

		it("Effect.logError emits ::error:: workflow command", async () => {
			const program = Effect.logError("error message");
			await runWithDefault(program);

			expect(captured.join("")).toContain("::error::error message");
		});
	});

	describe("ActionOutputs integration", () => {
		it("set writes key=value to GITHUB_OUTPUT file", async () => {
			const program = Effect.flatMap(ActionOutputs, (svc) => svc.set("result", "success"));
			await runWithDefault(program);

			const content = fs.readFileSync(outputFile, "utf8");
			expect(content).toBe("result=success\n");
		});

		it("setJson writes JSON-encoded value to GITHUB_OUTPUT file", async () => {
			const MySchema = Schema.Struct({ count: Schema.Number });
			const program = Effect.flatMap(ActionOutputs, (svc) => svc.setJson("data", { count: 42 }, MySchema));
			await runWithDefault(program);

			const content = fs.readFileSync(outputFile, "utf8");
			expect(content).toBe('data={"count":42}\n');
		});
	});

	describe("ActionState integration", () => {
		it("save writes encoded state to GITHUB_STATE file", async () => {
			const MySchema = Schema.Struct({ token: Schema.String });
			const program = Effect.flatMap(ActionState, (svc) => svc.save("auth", { token: "abc" }, MySchema));
			await runWithDefault(program);

			const content = fs.readFileSync(stateFile, "utf8");
			expect(content).toBe(`auth=${JSON.stringify({ token: "abc" })}\n`);
		});

		it("getOptional returns None when state env var is not set", async () => {
			const MySchema = Schema.Struct({ token: Schema.String });
			const program = Effect.flatMap(ActionState, (svc) => svc.getOptional("missing", MySchema));
			const result = await runWithDefault(program);

			expect(result._tag).toBe("None");
		});
	});

	describe("ActionLogger integration", () => {
		it("group emits ::group:: and ::endgroup:: workflow commands", async () => {
			const program = Effect.flatMap(ActionLogger, (logger) => logger.group("my-group", Effect.void));
			await runWithDefault(program);

			const output = captured.join("");
			expect(output).toContain("::group::my-group");
			expect(output).toContain("::endgroup::");
		});
	});
});
