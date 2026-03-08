import { Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CommandRunnerError } from "../errors/CommandRunnerError.js";
import type { CommandResponse } from "../layers/CommandRunnerTest.js";
import { CommandRunnerTest } from "../layers/CommandRunnerTest.js";
import { CommandRunner } from "./CommandRunner.js";

// -- Shared provide helper --

const provide = <A, E>(responses: ReadonlyMap<string, CommandResponse>, effect: Effect.Effect<A, E, CommandRunner>) =>
	Effect.provide(effect, CommandRunnerTest.layer(responses));

const run = <A, E>(responses: ReadonlyMap<string, CommandResponse>, effect: Effect.Effect<A, E, CommandRunner>) =>
	Effect.runPromise(provide(responses, effect));

const runExit = <A, E>(responses: ReadonlyMap<string, CommandResponse>, effect: Effect.Effect<A, E, CommandRunner>) =>
	Effect.runPromise(Effect.exit(provide(responses, effect)));

const runEmpty = <A, E>(effect: Effect.Effect<A, E, CommandRunner>) =>
	Effect.runPromise(Effect.provide(effect, CommandRunnerTest.empty()));

// -- Service method shorthands --

const exec = (command: string, args?: ReadonlyArray<string>) =>
	Effect.flatMap(CommandRunner, (svc) => svc.exec(command, args));

const execCapture = (command: string, args?: ReadonlyArray<string>) =>
	Effect.flatMap(CommandRunner, (svc) => svc.execCapture(command, args));

const execJson = <A, I>(command: string, args: ReadonlyArray<string> | undefined, schema: Schema.Schema<A, I, never>) =>
	Effect.flatMap(CommandRunner, (svc) => svc.execJson(command, args, schema));

const execLines = (command: string, args?: ReadonlyArray<string>) =>
	Effect.flatMap(CommandRunner, (svc) => svc.execLines(command, args));

// -- Helper to build response maps --

const responses = (...entries: [string, CommandResponse][]): ReadonlyMap<string, CommandResponse> => new Map(entries);

describe("CommandRunner", () => {
	describe("exec", () => {
		it("returns 0 for successful command", async () => {
			const result = await runEmpty(exec("echo", ["hello"]));
			expect(result).toBe(0);
		});

		it("fails with CommandRunnerError on non-zero exit code", async () => {
			const exit = await runExit(
				responses(["git status", { exitCode: 128, stdout: "", stderr: "fatal: not a git repo" }]),
				exec("git", ["status"]),
			);
			expect(exit._tag).toBe("Failure");
			if (Exit.isFailure(exit)) {
				const error = exit.cause.pipe((cause) => {
					if (cause._tag === "Fail") return cause.error;
					return undefined;
				});
				expect(error).toBeInstanceOf(CommandRunnerError);
				if (error instanceof CommandRunnerError) {
					expect(error.exitCode).toBe(128);
					expect(error.stderr).toBe("fatal: not a git repo");
				}
			}
		});
	});

	describe("execCapture", () => {
		it("captures stdout and stderr", async () => {
			const result = await run(
				responses(["ls -la", { exitCode: 0, stdout: "file1\nfile2\n", stderr: "" }]),
				execCapture("ls", ["-la"]),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("file1\nfile2\n");
			expect(result.stderr).toBe("");
		});

		it("fails on non-zero exit code", async () => {
			const exit = await runExit(
				responses(["npm install", { exitCode: 1, stdout: "", stderr: "ERR!" }]),
				execCapture("npm", ["install"]),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("execJson", () => {
		const PackageInfo = Schema.Struct({
			name: Schema.String,
			version: Schema.String,
		});

		it("parses and validates JSON stdout", async () => {
			const jsonOutput = JSON.stringify({ name: "my-pkg", version: "1.0.0" });
			const result = await run(
				responses(["npm info", { exitCode: 0, stdout: jsonOutput, stderr: "" }]),
				execJson("npm", ["info"], PackageInfo),
			);
			expect(result).toEqual({ name: "my-pkg", version: "1.0.0" });
		});

		it("fails on invalid JSON", async () => {
			const exit = await runExit(
				responses(["npm info", { exitCode: 0, stdout: "not json", stderr: "" }]),
				execJson("npm", ["info"], PackageInfo),
			);
			expect(exit._tag).toBe("Failure");
		});

		it("fails when JSON does not match schema", async () => {
			const exit = await runExit(
				responses(["npm info", { exitCode: 0, stdout: JSON.stringify({ wrong: "shape" }), stderr: "" }]),
				execJson("npm", ["info"], PackageInfo),
			);
			expect(exit._tag).toBe("Failure");
		});

		it("fails on non-zero exit code before parsing", async () => {
			const exit = await runExit(
				responses(["npm info", { exitCode: 1, stdout: "", stderr: "not found" }]),
				execJson("npm", ["info"], PackageInfo),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("execLines", () => {
		it("splits stdout into trimmed non-empty lines", async () => {
			const result = await run(
				responses(["git branch", { exitCode: 0, stdout: "  main\n  feature/foo\n  fix/bar\n", stderr: "" }]),
				execLines("git", ["branch"]),
			);
			expect(result).toEqual(["main", "feature/foo", "fix/bar"]);
		});

		it("filters blank lines", async () => {
			const result = await run(
				responses(["echo", { exitCode: 0, stdout: "line1\n\n\nline2\n", stderr: "" }]),
				execLines("echo"),
			);
			expect(result).toEqual(["line1", "line2"]);
		});

		it("returns empty array for empty stdout", async () => {
			const result = await runEmpty(execLines("true"));
			expect(result).toEqual([]);
		});
	});

	describe("CommandRunnerError", () => {
		it("is a tagged error with correct fields", () => {
			const error = new CommandRunnerError({
				command: "npm",
				args: ["install"],
				exitCode: 1,
				stderr: "ERR!",
				reason: "Command failed",
			});
			expect(error._tag).toBe("CommandRunnerError");
			expect(error.command).toBe("npm");
			expect(error.args).toEqual(["install"]);
			expect(error.exitCode).toBe(1);
			expect(error.stderr).toBe("ERR!");
			expect(error.reason).toBe("Command failed");
		});
	});

	describe("test layer lookup", () => {
		it("matches exact command+args key", async () => {
			const result = await run(
				responses(
					["git", { exitCode: 0, stdout: "fallback", stderr: "" }],
					["git status", { exitCode: 0, stdout: "specific", stderr: "" }],
				),
				execCapture("git", ["status"]),
			);
			expect(result.stdout).toBe("specific");
		});

		it("falls back to command-only key", async () => {
			const result = await run(
				responses(["git", { exitCode: 0, stdout: "fallback", stderr: "" }]),
				execCapture("git", ["log", "--oneline"]),
			);
			expect(result.stdout).toBe("fallback");
		});

		it("defaults to empty success when no match", async () => {
			const result = await runEmpty(execCapture("unknown-cmd"));
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
		});
	});
});
