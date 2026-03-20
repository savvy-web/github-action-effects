import { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { RuntimeEnvironmentError } from "../errors/RuntimeEnvironmentError.js";
import { append, prepareValue } from "./RuntimeFile.js";

// -- Mock FileSystem --

interface MockFsState {
	files: Record<string, string>;
}

const makeMockFs = (state: MockFsState): FileSystem.FileSystem => {
	return {
		writeFileString: (path: string, data: string, options?: { flag?: string }) => {
			const flag = options?.flag ?? "w";
			if (flag === "a") {
				state.files[path] = (state.files[path] ?? "") + data;
			} else {
				state.files[path] = data;
			}
			return Effect.void;
		},
		// Stub all other methods to satisfy the interface
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
	} as unknown as FileSystem.FileSystem;
};

const makeTestLayer = (state: MockFsState) => Layer.succeed(FileSystem.FileSystem, makeMockFs(state));

const run = <A>(state: MockFsState, effect: Effect.Effect<A, RuntimeEnvironmentError, FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.provide(effect, makeTestLayer(state)));

const runFail = <A>(state: MockFsState, effect: Effect.Effect<A, RuntimeEnvironmentError, FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.flip(Effect.provide(effect, makeTestLayer(state))));

// -- Tests --

describe("prepareValue", () => {
	it("formats a single-line value as key=value\\n", () => {
		expect(prepareValue("key", "value")).toBe("key=value\n");
	});

	it("formats a multiline value using delimiter format", () => {
		const result = prepareValue("key", "line1\nline2");
		// Should start with key<<ghadelimiter_<uuid>
		expect(result).toMatch(/^key<<ghadelimiter_[a-f0-9-]+\nline1\nline2\nghadelimiter_[a-f0-9-]+\n$/);
	});

	it("uses a unique delimiter per call", () => {
		const result1 = prepareValue("key", "a\nb");
		const result2 = prepareValue("key", "a\nb");
		// Extract delimiter from first line of each result
		const delimiter1 = result1.split("\n")[0]?.replace("key<<", "");
		const delimiter2 = result2.split("\n")[0]?.replace("key<<", "");
		expect(delimiter1).not.toBe(delimiter2);
	});
});

describe("append", () => {
	it("appends a single-line key-value pair to the file at the env var path", async () => {
		const state: MockFsState = { files: {} };
		process.env.TEST_OUTPUT_FILE = "/tmp/test-output";

		await run(state, append("TEST_OUTPUT_FILE", "myKey", "myValue"));

		expect(state.files["/tmp/test-output"]).toBe("myKey=myValue\n");

		delete process.env.TEST_OUTPUT_FILE;
	});

	it("appends multiple values to the same file", async () => {
		const state: MockFsState = { files: {} };
		process.env.TEST_OUTPUT_FILE = "/tmp/test-multi";

		await run(
			state,
			Effect.flatMap(append("TEST_OUTPUT_FILE", "key1", "val1"), () => append("TEST_OUTPUT_FILE", "key2", "val2")),
		);

		expect(state.files["/tmp/test-multi"]).toBe("key1=val1\nkey2=val2\n");

		delete process.env.TEST_OUTPUT_FILE;
	});

	it("returns RuntimeEnvironmentError when env var is undefined", async () => {
		const state: MockFsState = { files: {} };
		delete process.env.MISSING_ENV_VAR;

		const error = await runFail(state, append("MISSING_ENV_VAR", "key", "value"));

		expect(error._tag).toBe("RuntimeEnvironmentError");
		expect(error.variable).toBe("MISSING_ENV_VAR");
	});

	it("appends multiline value using delimiter format", async () => {
		const state: MockFsState = { files: {} };
		process.env.TEST_OUTPUT_FILE = "/tmp/test-multiline";

		await run(state, append("TEST_OUTPUT_FILE", "myKey", "line1\nline2"));

		const content = state.files["/tmp/test-multiline"] ?? "";
		expect(content).toMatch(/^myKey<<ghadelimiter_[a-f0-9-]+\nline1\nline2\nghadelimiter_[a-f0-9-]+\n$/);

		delete process.env.TEST_OUTPUT_FILE;
	});

	it("returns RuntimeEnvironmentError when file write fails", async () => {
		const failingFs = {
			...makeMockFs({ files: {} }),
			writeFileString: () =>
				Effect.fail({
					_tag: "SystemError" as const,
					reason: "Unknown" as const,
					module: "FileSystem" as const,
					method: "writeFileString",
					description: "permission denied",
				}),
		} as unknown as FileSystem.FileSystem;

		const failLayer = Layer.succeed(FileSystem.FileSystem, failingFs);
		process.env.TEST_WRITE_FAIL = "/tmp/fail-path";

		const error = await Effect.runPromise(
			append("TEST_WRITE_FAIL", "key", "value").pipe(Effect.provide(failLayer), Effect.flip),
		);

		expect(error._tag).toBe("RuntimeEnvironmentError");
		expect(error.message).toContain("Failed to write to file");
		expect(error.message).toContain("permission denied");

		delete process.env.TEST_WRITE_FAIL;
	});
});
