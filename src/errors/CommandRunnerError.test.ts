import { describe, expect, it } from "vitest";
import { CommandRunnerError } from "./CommandRunnerError.js";

describe("CommandRunnerError", () => {
	it("preserves _tag as CommandRunnerError", () => {
		const error = new CommandRunnerError({
			command: "git",
			args: ["fetch", "origin"],
			exitCode: 1,
			stderr: undefined,
			reason: "Command exited with code 1",
		});
		expect(error._tag).toBe("CommandRunnerError");
	});

	it("includes command and args in message", () => {
		const error = new CommandRunnerError({
			command: "git",
			args: ["fetch", "origin"],
			exitCode: 1,
			stderr: undefined,
			reason: "Command exited with code 1",
		});
		expect(error.message).toContain("git fetch origin");
	});

	it("includes exit code in message", () => {
		const error = new CommandRunnerError({
			command: "git",
			args: ["fetch", "origin"],
			exitCode: 1,
			stderr: undefined,
			reason: "Command exited with code 1",
		});
		expect(error.message).toContain("exit 1");
	});

	it("includes stderr when available", () => {
		const error = new CommandRunnerError({
			command: "git",
			args: ["push"],
			exitCode: 128,
			stderr: "fatal: remote origin already exists",
			reason: "Command exited with code 128",
		});
		expect(error.message).toContain("fatal: remote origin already exists");
	});

	it("handles empty args", () => {
		const error = new CommandRunnerError({
			command: "node",
			args: [],
			exitCode: 1,
			stderr: undefined,
			reason: "Command exited with code 1",
		});
		expect(error.message).toContain('Command "node" failed');
		expect(error.message).not.toContain("node  ");
	});

	it("truncates long stderr to 500 characters", () => {
		const longStderr = "x".repeat(1000);
		const error = new CommandRunnerError({
			command: "git",
			args: ["push"],
			exitCode: 1,
			stderr: longStderr,
			reason: "Command exited with code 1",
		});
		// The stderr portion should be at most 500 chars
		expect(error.message).toContain("x".repeat(500));
		expect(error.message).not.toContain("x".repeat(501));
	});
});
