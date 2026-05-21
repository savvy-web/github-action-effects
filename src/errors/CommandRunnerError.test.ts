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

	it("shows the tail of long stderr (where errors live) with a head-truncated marker", () => {
		// `npm` writes warnings and notices first and the actual `npm error`
		// lines last; the formatter shows the trailing 2000 chars to surface
		// the cause, with a `...[N chars truncated from head]...` marker
		// before the tail.
		const head = "h".repeat(1000);
		const tail = "t".repeat(2000);
		const longStderr = `${head}\n${tail}`;
		const error = new CommandRunnerError({
			command: "git",
			args: ["push"],
			exitCode: 1,
			stderr: longStderr,
			reason: "Command exited with code 1",
		});

		// The tail (the actual error) is preserved …
		expect(error.message).toContain(tail);
		// … the head is not …
		expect(error.message).not.toContain(head);
		// … and a truncation marker appears.
		expect(error.message).toMatch(/\.\.\.\[\d+ chars truncated from head\]\.\.\./);
	});

	it("includes the full stderr when shorter than the cap", () => {
		const stderr = "npm error 403 Forbidden";
		const error = new CommandRunnerError({
			command: "npm",
			args: ["publish"],
			exitCode: 1,
			stderr,
			reason: "Command exited with code 1",
		});

		expect(error.message).toContain(stderr);
		expect(error.message).not.toContain("truncated from head");
	});

	it("falls back to stdout when stderr is empty", () => {
		// Some CLIs route error context to stdout. Carry it on the error too
		// so the formatter can surface it as a last resort.
		const error = new CommandRunnerError({
			command: "npm",
			args: ["publish"],
			exitCode: 1,
			stderr: "",
			stdout: "npm error E403 Forbidden",
			reason: "Command exited with code 1",
		});

		expect(error.message).toContain("npm error E403 Forbidden");
	});
});
