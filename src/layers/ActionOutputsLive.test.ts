import { FileSystem } from "@effect/platform";
import { Cause, Chunk, Effect, Layer, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionOutputs } from "../services/ActionOutputs.js";
import { ActionOutputsLive } from "./ActionOutputsLive.js";

// -- Mock FileSystem --

interface MockFsState {
	files: Record<string, string>;
}

const makeMockFs = (state: MockFsState): FileSystem.FileSystem =>
	({
		writeFileString: (path: string, data: string, options?: { flag?: string }) => {
			const flag = options?.flag ?? "w";
			if (flag === "a") {
				state.files[path] = (state.files[path] ?? "") + data;
			} else {
				state.files[path] = data;
			}
			return Effect.void;
		},
		readFileString: () => Effect.die("not implemented"),
		access: () => Effect.void,
		readDirectory: () => Effect.succeed([]),
		chmod: () => Effect.void,
		chown: () => Effect.void,
		copy: () => Effect.void,
		copyFile: () => Effect.void,
		exists: () => Effect.succeed(true),
		link: () => Effect.void,
		makeDirectory: () => Effect.void,
		makeTempDirectory: () => Effect.succeed("/tmp/test"),
		makeTempDirectoryScoped: () => Effect.succeed("/tmp/test"),
		makeTempFile: () => Effect.succeed("/tmp/test-file"),
		makeTempFileScoped: () => Effect.succeed("/tmp/test-file"),
		open: () => Effect.die("not implemented"),
		readFile: () => Effect.die("not implemented"),
		readLink: () => Effect.succeed("/tmp"),
		realPath: () => Effect.succeed("/tmp"),
		remove: () => Effect.void,
		rename: () => Effect.void,
		sink: () => Effect.die("not implemented") as never,
		stat: () => Effect.die("not implemented"),
		stream: () => Effect.die("not implemented") as never,
		symlink: () => Effect.void,
		truncate: () => Effect.void,
		utimes: () => Effect.void,
		watch: () => Effect.die("not implemented") as never,
		writeFile: () => Effect.void,
	}) as unknown as FileSystem.FileSystem;

const makeFaultyMockFs = (state: MockFsState): FileSystem.FileSystem => {
	const base = makeMockFs(state);
	return {
		...base,
		writeFileString: (_path: string, _data: string, _options?: { flag?: string }) =>
			Effect.fail(
				Object.assign(new Error("disk full"), {
					_tag: "SystemError",
					description: "disk full",
					reason: "Unknown",
					module: "FileSystem",
					method: "writeFileString",
				}),
			) as never,
	} as unknown as FileSystem.FileSystem;
};

const makeTestLayer = (state: MockFsState) => Layer.succeed(FileSystem.FileSystem, makeMockFs(state));

const makeFaultyTestLayer = (state: MockFsState) => Layer.succeed(FileSystem.FileSystem, makeFaultyMockFs(state));

const run = <A, E>(state: MockFsState, effect: Effect.Effect<A, E, ActionOutputs>) =>
	Effect.runPromise(Effect.provide(effect, ActionOutputsLive.pipe(Layer.provide(makeTestLayer(state)))));

const runExit = <A, E>(state: MockFsState, effect: Effect.Effect<A, E, ActionOutputs>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, ActionOutputsLive.pipe(Layer.provide(makeTestLayer(state))))));

const runExitFaulty = <A, E>(state: MockFsState, effect: Effect.Effect<A, E, ActionOutputs>) =>
	Effect.runPromise(
		Effect.exit(Effect.provide(effect, ActionOutputsLive.pipe(Layer.provide(makeFaultyTestLayer(state))))),
	);

// -- Tests --

describe("ActionOutputsLive", () => {
	beforeEach(() => {
		process.env.GITHUB_OUTPUT = "/tmp/github-output";
		process.env.GITHUB_ENV = "/tmp/github-env";
		process.env.GITHUB_PATH = "/tmp/github-path";
		process.env.GITHUB_STEP_SUMMARY = "/tmp/github-step-summary";
	});

	afterEach(() => {
		delete process.env.GITHUB_OUTPUT;
		delete process.env.GITHUB_ENV;
		delete process.env.GITHUB_PATH;
		delete process.env.GITHUB_STEP_SUMMARY;
	});

	describe("set", () => {
		it("appends key=value to GITHUB_OUTPUT file", async () => {
			const state: MockFsState = { files: {} };
			await run(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.set("key", "value")),
			);
			expect(state.files["/tmp/github-output"]).toBe("key=value\n");
		});

		it("appends multiline value using delimiter format to GITHUB_OUTPUT", async () => {
			const state: MockFsState = { files: {} };
			await run(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.set("key", "multi\nline")),
			);
			const content = state.files["/tmp/github-output"] ?? "";
			expect(content).toMatch(/^key<<ghadelimiter_[a-f0-9-]+\nmulti\nline\nghadelimiter_[a-f0-9-]+\n$/);
		});

		it("dies with ActionOutputError when GITHUB_OUTPUT is not set", async () => {
			delete process.env.GITHUB_OUTPUT;
			const state: MockFsState = { files: {} };
			const exit = await runExit(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.set("key", "value")),
			);
			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				expect(Cause.isDie(exit.cause)).toBe(true);
				const defect = Chunk.toArray(Cause.defects(exit.cause))[0] as { _tag: string; outputName: string };
				expect(defect._tag).toBe("ActionOutputError");
				expect(defect.outputName).toBe("key");
			}
		});
	});

	describe("setJson", () => {
		it("serializes and appends JSON output to GITHUB_OUTPUT", async () => {
			const state: MockFsState = { files: {} };
			const MySchema = Schema.Struct({ a: Schema.Number });
			await run(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.setJson("key", { a: 1 }, MySchema)),
			);
			expect(state.files["/tmp/github-output"]).toBe('key={"a":1}\n');
		});

		it("fails with ActionOutputError on schema validation error", async () => {
			const state: MockFsState = { files: {} };
			const MySchema = Schema.Struct({ count: Schema.Number });
			const exit = await runExit(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.setJson("data", { count: "bad" as unknown as number }, MySchema)),
			);
			expect(exit._tag).toBe("Failure");
		});

		it("fails with ActionOutputError when GITHUB_OUTPUT is not set (RuntimeEnvironmentError branch)", async () => {
			delete process.env.GITHUB_OUTPUT;
			const state: MockFsState = { files: {} };
			const MySchema = Schema.Struct({ a: Schema.Number });
			const exit = await runExit(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.setJson("out", { a: 1 }, MySchema)),
			);
			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				const first = Chunk.toArray(Cause.failures(exit.cause))[0] as {
					_tag: string;
					outputName: string;
					reason: string;
				};
				expect(first._tag).toBe("ActionOutputError");
				expect(first.outputName).toBe("out");
				expect(first.reason).toContain("GITHUB_OUTPUT");
			}
		});
	});

	describe("summary", () => {
		it("appends content to GITHUB_STEP_SUMMARY file", async () => {
			const state: MockFsState = { files: {} };
			await run(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.summary("# Title")),
			);
			expect(state.files["/tmp/github-step-summary"]).toBe("# Title");
		});

		it("fails with ActionOutputError when GITHUB_STEP_SUMMARY is not set", async () => {
			delete process.env.GITHUB_STEP_SUMMARY;
			const state: MockFsState = { files: {} };
			const exit = await runExit(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.summary("# Title")),
			);
			expect(exit._tag).toBe("Failure");
		});

		it("fails with ActionOutputError when the summary file write fails", async () => {
			const state: MockFsState = { files: {} };
			const exit = await runExitFaulty(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.summary("# Title")),
			);
			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				const first = Chunk.toArray(Cause.failures(exit.cause))[0] as {
					_tag: string;
					outputName: string;
					reason: string;
				};
				expect(first._tag).toBe("ActionOutputError");
				expect(first.outputName).toBe("summary");
				expect(first.reason).toContain("Failed to write step summary");
			}
		});
	});

	describe("exportVariable", () => {
		it("appends to GITHUB_ENV file and sets process.env", async () => {
			const state: MockFsState = { files: {} };
			delete process.env.FOO;
			await run(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.exportVariable("FOO", "bar")),
			);
			expect(state.files["/tmp/github-env"]).toBe("FOO=bar\n");
			expect(process.env.FOO).toBe("bar");
			delete process.env.FOO;
		});
	});

	describe("addPath", () => {
		it("appends path to GITHUB_PATH file and prepends to process.env.PATH", async () => {
			const state: MockFsState = { files: {} };
			const originalPath = process.env.PATH ?? "";
			await run(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.addPath("/bin")),
			);
			expect(state.files["/tmp/github-path"]).toBe("/bin\n");
			expect(process.env.PATH).toBe(`/bin:${originalPath}`);
			process.env.PATH = originalPath;
		});

		it("only updates process.env.PATH when GITHUB_PATH is not set", async () => {
			delete process.env.GITHUB_PATH;
			const state: MockFsState = { files: {} };
			const originalPath = process.env.PATH ?? "";
			await run(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.addPath("/custom/bin")),
			);
			expect(Object.keys(state.files)).toHaveLength(0);
			expect(process.env.PATH).toBe(`/custom/bin:${originalPath}`);
			process.env.PATH = originalPath;
		});
	});

	describe("setSecret", () => {
		it("writes ::add-mask:: command to stdout", async () => {
			const state: MockFsState = { files: {} };
			const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
			await run(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.setSecret("token")),
			);
			expect(writeSpy).toHaveBeenCalledWith("::add-mask::token\n");
			writeSpy.mockRestore();
		});
	});

	describe("setFailed", () => {
		it("writes ::error:: command to stdout and sets process.exitCode to 1", async () => {
			const state: MockFsState = { files: {} };
			const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
			const originalExitCode = process.exitCode;
			await run(
				state,
				Effect.flatMap(ActionOutputs, (svc) => svc.setFailed("msg")),
			);
			expect(writeSpy).toHaveBeenCalledWith("::error::msg\n");
			expect(process.exitCode).toBe(1);
			writeSpy.mockRestore();
			process.exitCode = originalExitCode;
		});
	});
});
