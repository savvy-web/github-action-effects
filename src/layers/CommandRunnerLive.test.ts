import * as fs from "node:fs";
import * as os from "node:os";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CommandRunner } from "../services/CommandRunner.js";
import { CommandRunnerLive } from "./CommandRunnerLive.js";

const run = <A, E>(effect: Effect.Effect<A, E, CommandRunner>) =>
	Effect.runPromise(Effect.provide(effect, CommandRunnerLive));

const runExit = <A, E>(effect: Effect.Effect<A, E, CommandRunner>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, CommandRunnerLive)));

describe("CommandRunnerLive", () => {
	describe("exec", () => {
		it("runs a command and returns exit code 0", async () => {
			const result = await run(Effect.flatMap(CommandRunner, (svc) => svc.exec("echo", ["hello"])));
			expect(result).toBe(0);
		});

		it("fails with CommandRunnerError on non-zero exit", async () => {
			const exit = await runExit(Effect.flatMap(CommandRunner, (svc) => svc.exec("sh", ["-c", "exit 1"])));
			expect(exit._tag).toBe("Failure");
		});

		it("fails with CommandRunnerError for invalid command", async () => {
			const exit = await runExit(Effect.flatMap(CommandRunner, (svc) => svc.exec("this-command-does-not-exist-xyz")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("execCapture", () => {
		it("captures stdout", async () => {
			const result = await run(Effect.flatMap(CommandRunner, (svc) => svc.execCapture("echo", ["hello"])));
			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("hello");
		});

		it("captures stderr", async () => {
			const result = await run(Effect.flatMap(CommandRunner, (svc) => svc.execCapture("sh", ["-c", "echo err >&2"])));
			expect(result.exitCode).toBe(0);
			expect(result.stderr.trim()).toBe("err");
		});

		it("fails with CommandRunnerError on non-zero exit", async () => {
			const exit = await runExit(
				Effect.flatMap(CommandRunner, (svc) => svc.execCapture("sh", ["-c", "echo fail >&2; exit 2"])),
			);
			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				const error = exit.cause;
				// Verify it's a CommandRunnerError by checking the cause
				expect(String(error)).toContain("CommandRunnerError");
			}
		});
	});

	describe("execJson", () => {
		it("parses JSON output", async () => {
			const MySchema = Schema.Struct({ name: Schema.String, version: Schema.String });
			const result = await run(
				Effect.flatMap(CommandRunner, (svc) => svc.execJson("echo", ['{"name":"test","version":"1.0.0"}'], MySchema)),
			);
			expect(result).toEqual({ name: "test", version: "1.0.0" });
		});

		it("fails on invalid JSON stdout", async () => {
			const exit = await runExit(
				Effect.flatMap(CommandRunner, (svc) => svc.execJson("echo", ["not json"], Schema.String)),
			);
			expect(exit._tag).toBe("Failure");
		});

		it("fails when schema does not match", async () => {
			const MySchema = Schema.Struct({ name: Schema.String });
			const exit = await runExit(
				Effect.flatMap(CommandRunner, (svc) => svc.execJson("echo", ['{"wrong":"shape"}'], MySchema)),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("execLines", () => {
		it("splits stdout into trimmed non-empty lines", async () => {
			const result = await run(
				Effect.flatMap(CommandRunner, (svc) => svc.execLines("printf", ["line1\\nline2\\nline3\\n"])),
			);
			expect(result).toEqual(["line1", "line2", "line3"]);
		});

		it("filters blank lines and trims whitespace", async () => {
			const result = await run(
				Effect.flatMap(CommandRunner, (svc) =>
					svc.execLines("sh", ["-c", "echo '  line1  '; echo ''; echo '  line2  '"]),
				),
			);
			expect(result).toEqual(["line1", "line2"]);
		});
	});

	describe("options", () => {
		it("respects cwd option", async () => {
			const tmpDir = fs.realpathSync(os.tmpdir());
			const result = await run(Effect.flatMap(CommandRunner, (svc) => svc.execCapture("pwd", [], { cwd: tmpDir })));
			expect(result.stdout.trim()).toBe(tmpDir);
		});

		it("respects env option", async () => {
			const result = await run(
				Effect.flatMap(CommandRunner, (svc) =>
					svc.execCapture("sh", ["-c", "echo $MY_TEST_VAR"], {
						env: { MY_TEST_VAR: "hello-from-env" },
					}),
				),
			);
			expect(result.stdout.trim()).toBe("hello-from-env");
		});
	});

	describe("error shape", () => {
		it("CommandRunnerError has correct fields", async () => {
			const exit = await runExit(Effect.flatMap(CommandRunner, (svc) => svc.exec("sh", ["-c", "exit 42"])));
			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				// Extract error from cause
				const defect = exit.cause;
				const errStr = String(defect);
				expect(errStr).toContain("CommandRunnerError");
			}
		});
	});
});
