import { Effect, Layer, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { ActionsExecOptions } from "../services/ActionsExec.js";
import { ActionsExec } from "../services/ActionsExec.js";
import { CommandRunner } from "../services/CommandRunner.js";
import { CommandRunnerLive } from "./CommandRunnerLive.js";

const mockActionsExec = (
	execFn: (commandLine: string, args?: string[], options?: ActionsExecOptions) => Promise<number>,
) => Layer.succeed(ActionsExec, { exec: execFn });

const mockExec = (exitCode: number, stdout = "", stderr = "") =>
	mockActionsExec(async (_cmd, _args, options) => {
		if (options?.listeners?.stdout && stdout) {
			options.listeners.stdout(Buffer.from(stdout));
		}
		if (options?.listeners?.stderr && stderr) {
			options.listeners.stderr(Buffer.from(stderr));
		}
		return exitCode;
	});

const run = <A, E>(effect: Effect.Effect<A, E, CommandRunner>, execLayer = mockExec(0)) =>
	Effect.runPromise(Effect.provide(effect, CommandRunnerLive.pipe(Layer.provide(execLayer))));

const runExit = <A, E>(effect: Effect.Effect<A, E, CommandRunner>, execLayer = mockExec(0)) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, CommandRunnerLive.pipe(Layer.provide(execLayer)))));

describe("CommandRunnerLive", () => {
	describe("exec", () => {
		it("runs a command and returns exit code", async () => {
			const execFn = vi.fn().mockResolvedValue(0);
			const result = await run(
				Effect.flatMap(CommandRunner, (svc) => svc.exec("echo", ["hello"])),
				mockActionsExec(execFn),
			);
			expect(result).toBe(0);
			expect(execFn).toHaveBeenCalledWith("echo", ["hello"], expect.objectContaining({ ignoreReturnCode: true }));
		});

		it("fails on non-zero exit code", async () => {
			const exit = await runExit(
				Effect.flatMap(CommandRunner, (svc) => svc.exec("fail-cmd")),
				mockExec(1, "", "error output"),
			);
			expect(exit._tag).toBe("Failure");
		});

		it("passes options through", async () => {
			const execFn = vi.fn().mockResolvedValue(0);
			await run(
				Effect.flatMap(CommandRunner, (svc) => svc.exec("cmd", [], { cwd: "/tmp", silent: false, timeout: 5000 })),
				mockActionsExec(execFn),
			);
			expect(execFn).toHaveBeenCalledWith(
				"cmd",
				[],
				expect.objectContaining({ cwd: "/tmp", silent: false, delay: 5000 }),
			);
		});
	});

	describe("execCapture", () => {
		it("captures stdout and stderr", async () => {
			const result = await run(
				Effect.flatMap(CommandRunner, (svc) => svc.execCapture("cmd")),
				mockExec(0, "output line\n", "warning\n"),
			);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("output line\n");
			expect(result.stderr).toBe("warning\n");
		});
	});

	describe("execJson", () => {
		it("parses JSON output", async () => {
			const MySchema = Schema.Struct({ name: Schema.String, version: Schema.String });
			const result = await run(
				Effect.flatMap(CommandRunner, (svc) => svc.execJson("cmd", [], MySchema)),
				mockExec(0, '{"name":"test","version":"1.0.0"}'),
			);
			expect(result).toEqual({ name: "test", version: "1.0.0" });
		});

		it("fails on invalid JSON", async () => {
			const exit = await runExit(
				Effect.flatMap(CommandRunner, (svc) => svc.execJson("cmd", [], Schema.String)),
				mockExec(0, "not json"),
			);
			expect(exit._tag).toBe("Failure");
		});

		it("fails when schema doesn't match", async () => {
			const MySchema = Schema.Struct({ name: Schema.String });
			const exit = await runExit(
				Effect.flatMap(CommandRunner, (svc) => svc.execJson("cmd", [], MySchema)),
				mockExec(0, '{"wrong":"shape"}'),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("execLines", () => {
		it("splits output into lines", async () => {
			const result = await run(
				Effect.flatMap(CommandRunner, (svc) => svc.execLines("cmd")),
				mockExec(0, "line1\nline2\nline3\n"),
			);
			expect(result).toEqual(["line1", "line2", "line3"]);
		});

		it("trims and filters blank lines", async () => {
			const result = await run(
				Effect.flatMap(CommandRunner, (svc) => svc.execLines("cmd")),
				mockExec(0, "  line1  \n\n  line2  \n"),
			);
			expect(result).toEqual(["line1", "line2"]);
		});
	});

	describe("error handling", () => {
		it("wraps exec rejection in CommandRunnerError", async () => {
			const exit = await runExit(
				Effect.flatMap(CommandRunner, (svc) => svc.exec("bad-cmd")),
				mockActionsExec(() => Promise.reject(new Error("spawn failed"))),
			);
			expect(exit._tag).toBe("Failure");
		});
	});
});
