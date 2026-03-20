import { FileSystem } from "@effect/platform";
import { Effect, Layer, Option, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionState } from "../services/ActionState.js";
import { ActionStateLive } from "./ActionStateLive.js";

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

const makeTestLayer = (state: MockFsState) => Layer.succeed(FileSystem.FileSystem, makeMockFs(state));

const run = <A, E>(state: MockFsState, effect: Effect.Effect<A, E, ActionState>) =>
	Effect.runPromise(Effect.provide(effect, ActionStateLive.pipe(Layer.provide(makeTestLayer(state)))));

const runExit = <A, E>(state: MockFsState, effect: Effect.Effect<A, E, ActionState>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, ActionStateLive.pipe(Layer.provide(makeTestLayer(state))))));

// -- Tests --

const TestSchema = Schema.Struct({
	token: Schema.String,
	count: Schema.Number,
});

describe("ActionStateLive", () => {
	beforeEach(() => {
		process.env.GITHUB_STATE = "/tmp/github-state";
	});

	afterEach(() => {
		delete process.env.GITHUB_STATE;
		delete process.env.STATE_auth;
		delete process.env.STATE_started;
		delete process.env.STATE_missing;
		delete process.env.STATE_bad;
	});

	describe("save", () => {
		it("encodes and appends to GITHUB_STATE file", async () => {
			const state: MockFsState = { files: {} };
			await run(
				state,
				Effect.flatMap(ActionState, (svc) => svc.save("auth", { token: "abc", count: 1 }, TestSchema)),
			);
			expect(state.files["/tmp/github-state"]).toBe(`auth=${JSON.stringify({ token: "abc", count: 1 })}\n`);
		});

		it("encodes Date via Schema.DateFromString", async () => {
			const state: MockFsState = { files: {} };
			const date = new Date("2026-01-15T00:00:00.000Z");
			await run(
				state,
				Effect.flatMap(ActionState, (svc) => svc.save("started", date, Schema.DateFromString)),
			);
			expect(state.files["/tmp/github-state"]).toBe(`started=${JSON.stringify("2026-01-15T00:00:00.000Z")}\n`);
		});

		it("fails when GITHUB_STATE is not set", async () => {
			delete process.env.GITHUB_STATE;
			const state: MockFsState = { files: {} };
			const exit = await runExit(
				state,
				Effect.flatMap(ActionState, (svc) => svc.save("auth", { token: "abc", count: 1 }, TestSchema)),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("get", () => {
		it("reads and decodes state from process.env", async () => {
			process.env.STATE_auth = JSON.stringify({ token: "xyz", count: 42 });
			const state: MockFsState = { files: {} };
			const result = await run(
				state,
				Effect.flatMap(ActionState, (svc) => svc.get("auth", TestSchema)),
			);
			expect(result).toEqual({ token: "xyz", count: 42 });
		});

		it("decodes DateFromString from process.env", async () => {
			process.env.STATE_started = JSON.stringify("2026-01-15T00:00:00.000Z");
			const state: MockFsState = { files: {} };
			const result = await run(
				state,
				Effect.flatMap(ActionState, (svc) => svc.get("started", Schema.DateFromString)),
			);
			expect(result).toBeInstanceOf(Date);
			expect(result.toISOString()).toBe("2026-01-15T00:00:00.000Z");
		});

		it("fails on missing key (env var not set)", async () => {
			const state: MockFsState = { files: {} };
			const exit = await runExit(
				state,
				Effect.flatMap(ActionState, (svc) => svc.get("missing", TestSchema)),
			);
			expect(exit._tag).toBe("Failure");
		});

		it("fails on invalid JSON", async () => {
			process.env.STATE_bad = "not-json";
			const state: MockFsState = { files: {} };
			const exit = await runExit(
				state,
				Effect.flatMap(ActionState, (svc) => svc.get("bad", TestSchema)),
			);
			expect(exit._tag).toBe("Failure");
		});

		it("fails on schema mismatch", async () => {
			process.env.STATE_auth = JSON.stringify({ wrong: "shape" });
			const state: MockFsState = { files: {} };
			const exit = await runExit(
				state,
				Effect.flatMap(ActionState, (svc) => svc.get("auth", TestSchema)),
			);
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getOptional", () => {
		it("returns Some for present state", async () => {
			process.env.STATE_auth = JSON.stringify({ token: "abc", count: 1 });
			const state: MockFsState = { files: {} };
			const result = await run(
				state,
				Effect.flatMap(ActionState, (svc) => svc.getOptional("auth", TestSchema)),
			);
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value).toEqual({ token: "abc", count: 1 });
			}
		});

		it("returns None for missing key (env var not set)", async () => {
			const state: MockFsState = { files: {} };
			const result = await run(
				state,
				Effect.flatMap(ActionState, (svc) => svc.getOptional("missing", TestSchema)),
			);
			expect(Option.isNone(result)).toBe(true);
		});

		it("fails on invalid JSON", async () => {
			process.env.STATE_bad = "bad-json";
			const state: MockFsState = { files: {} };
			const exit = await runExit(
				state,
				Effect.flatMap(ActionState, (svc) => svc.getOptional("bad", TestSchema)),
			);
			expect(exit._tag).toBe("Failure");
		});
	});
});
