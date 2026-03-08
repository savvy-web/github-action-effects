import { exec } from "@actions/exec";
import { Effect, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import { CommandRunner } from "../services/CommandRunner.js";
import { CommandRunnerLive } from "./CommandRunnerLive.js";

vi.mock("@actions/exec", () => ({
	exec: vi.fn(),
}));

const run = <A, E>(effect: Effect.Effect<A, E, CommandRunner>) =>
	Effect.runPromise(Effect.provide(effect, CommandRunnerLive));

const runExit = <A, E>(effect: Effect.Effect<A, E, CommandRunner>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, CommandRunnerLive)));

const mockExec = (exitCode: number, stdout = "", stderr = "") => {
	vi.mocked(exec).mockImplementation(async (_cmd, _args, options) => {
		if (options?.listeners?.stdout && stdout) {
			options.listeners.stdout(Buffer.from(stdout));
		}
		if (options?.listeners?.stderr && stderr) {
			options.listeners.stderr(Buffer.from(stderr));
		}
		return exitCode;
	});
};

describe("CommandRunnerLive", () => {
	describe("exec", () => {
		it("runs a command and returns exit code", async () => {
			mockExec(0);
			const result = await run(Effect.flatMap(CommandRunner, (svc) => svc.exec("echo", ["hello"])));
			expect(result).toBe(0);
			expect(exec).toHaveBeenCalledWith("echo", ["hello"], expect.objectContaining({ ignoreReturnCode: true }));
		});

		it("fails on non-zero exit code", async () => {
			mockExec(1, "", "error output");
			const exit = await runExit(Effect.flatMap(CommandRunner, (svc) => svc.exec("fail-cmd")));
			expect(exit._tag).toBe("Failure");
		});

		it("passes options through", async () => {
			mockExec(0);
			await run(
				Effect.flatMap(CommandRunner, (svc) => svc.exec("cmd", [], { cwd: "/tmp", silent: false, timeout: 5000 })),
			);
			expect(exec).toHaveBeenCalledWith(
				"cmd",
				[],
				expect.objectContaining({ cwd: "/tmp", silent: false, delay: 5000 }),
			);
		});
	});

	describe("execCapture", () => {
		it("captures stdout and stderr", async () => {
			mockExec(0, "output line\n", "warning\n");
			const result = await run(Effect.flatMap(CommandRunner, (svc) => svc.execCapture("cmd")));
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("output line\n");
			expect(result.stderr).toBe("warning\n");
		});
	});

	describe("execJson", () => {
		it("parses JSON output", async () => {
			mockExec(0, '{"name":"test","version":"1.0.0"}');
			const MySchema = Schema.Struct({ name: Schema.String, version: Schema.String });
			const result = await run(Effect.flatMap(CommandRunner, (svc) => svc.execJson("cmd", [], MySchema)));
			expect(result).toEqual({ name: "test", version: "1.0.0" });
		});

		it("fails on invalid JSON", async () => {
			mockExec(0, "not json");
			const exit = await runExit(Effect.flatMap(CommandRunner, (svc) => svc.execJson("cmd", [], Schema.String)));
			expect(exit._tag).toBe("Failure");
		});

		it("fails when schema doesn't match", async () => {
			mockExec(0, '{"wrong":"shape"}');
			const MySchema = Schema.Struct({ name: Schema.String });
			const exit = await runExit(Effect.flatMap(CommandRunner, (svc) => svc.execJson("cmd", [], MySchema)));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("execLines", () => {
		it("splits output into lines", async () => {
			mockExec(0, "line1\nline2\nline3\n");
			const result = await run(Effect.flatMap(CommandRunner, (svc) => svc.execLines("cmd")));
			expect(result).toEqual(["line1", "line2", "line3"]);
		});

		it("trims and filters blank lines", async () => {
			mockExec(0, "  line1  \n\n  line2  \n");
			const result = await run(Effect.flatMap(CommandRunner, (svc) => svc.execLines("cmd")));
			expect(result).toEqual(["line1", "line2"]);
		});
	});

	describe("error handling", () => {
		it("wraps exec rejection in CommandRunnerError", async () => {
			vi.mocked(exec).mockRejectedValue(new Error("spawn failed"));
			const exit = await runExit(Effect.flatMap(CommandRunner, (svc) => svc.exec("bad-cmd")));
			expect(exit._tag).toBe("Failure");
		});
	});
});
