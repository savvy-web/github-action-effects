import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionEnvironment } from "../services/ActionEnvironment.js";
import { ActionEnvironmentLive } from "./ActionEnvironmentLive.js";

const run = <A, E>(effect: Effect.Effect<A, E, ActionEnvironment>) =>
	Effect.runPromise(Effect.provide(effect, ActionEnvironmentLive));

const runExit = <A, E>(effect: Effect.Effect<A, E, ActionEnvironment>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, ActionEnvironmentLive)));

// `payload` / `repo` / `issue` require a FileSystem in their R channel.
const fsLayer = Layer.merge(ActionEnvironmentLive, NodeFileSystem.layer);

const runFs = <A, E>(effect: Effect.Effect<A, E, ActionEnvironment | FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.provide(effect, fsLayer));

const runFsExit = <A, E>(effect: Effect.Effect<A, E, ActionEnvironment | FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, fsLayer)));

const savedEnv: Record<string, string | undefined> = {};

const setEnv = (vars: Record<string, string>) => {
	for (const [key, value] of Object.entries(vars)) {
		savedEnv[key] = process.env[key];
		process.env[key] = value;
	}
};

const githubEnv: Record<string, string> = {
	GITHUB_SHA: "abc123",
	GITHUB_REF: "refs/heads/main",
	GITHUB_REPOSITORY: "owner/repo",
	GITHUB_REPOSITORY_OWNER: "owner",
	GITHUB_WORKSPACE: "/workspace",
	GITHUB_EVENT_NAME: "push",
	GITHUB_EVENT_PATH: "/event.json",
	GITHUB_RUN_ID: "1",
	GITHUB_RUN_NUMBER: "1",
	GITHUB_ACTOR: "user",
	GITHUB_SERVER_URL: "https://github.com",
	GITHUB_API_URL: "https://api.github.com",
	GITHUB_GRAPHQL_URL: "https://api.github.com/graphql",
	GITHUB_ACTION: "test",
	GITHUB_JOB: "build",
	GITHUB_WORKFLOW: "CI",
};

const runnerEnv: Record<string, string> = {
	RUNNER_OS: "Linux",
	RUNNER_ARCH: "X64",
	RUNNER_NAME: "runner-1",
	RUNNER_TEMP: "/tmp",
	RUNNER_TOOL_CACHE: "/cache",
};

beforeEach(() => {
	setEnv({ ...githubEnv, ...runnerEnv });
});

afterEach(() => {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

describe("ActionEnvironmentLive", () => {
	describe("get", () => {
		it("reads an environment variable", async () => {
			const result = await run(Effect.flatMap(ActionEnvironment, (svc) => svc.get("GITHUB_SHA")));
			expect(result).toBe("abc123");
		});

		it("fails on missing variable", async () => {
			delete process.env.MISSING_VAR;
			const exit = await runExit(Effect.flatMap(ActionEnvironment, (svc) => svc.get("MISSING_VAR")));
			expect(exit._tag).toBe("Failure");
		});
	});

	describe("getOptional", () => {
		it("returns Some for set variable", async () => {
			const result = await run(Effect.flatMap(ActionEnvironment, (svc) => svc.getOptional("GITHUB_SHA")));
			expect(Option.isSome(result)).toBe(true);
		});

		it("returns None for missing variable", async () => {
			delete process.env.NOT_SET;
			const result = await run(Effect.flatMap(ActionEnvironment, (svc) => svc.getOptional("NOT_SET")));
			expect(Option.isNone(result)).toBe(true);
		});
	});

	describe("github", () => {
		it("builds GitHub context from env vars", async () => {
			const result = await run(Effect.flatMap(ActionEnvironment, (svc) => svc.github));
			expect(result.sha).toBe("abc123");
			expect(result.repository).toBe("owner/repo");
			expect(result.eventName).toBe("push");
		});
	});

	describe("runner", () => {
		it("builds runner context from env vars", async () => {
			const result = await run(Effect.flatMap(ActionEnvironment, (svc) => svc.runner));
			expect(result.os).toBe("Linux");
			expect(result.arch).toBe("X64");
			expect(result.debug).toBe(false);
		});

		it("reads RUNNER_DEBUG=1 as true", async () => {
			process.env.RUNNER_DEBUG = "1";
			const result = await run(Effect.flatMap(ActionEnvironment, (svc) => svc.runner));
			expect(result.debug).toBe(true);
		});
	});

	describe("isDebug", () => {
		it("is true when RUNNER_DEBUG=1", async () => {
			process.env.RUNNER_DEBUG = "1";
			const result = await run(Effect.flatMap(ActionEnvironment, (svc) => svc.isDebug));
			expect(result).toBe(true);
		});

		it("is false when RUNNER_DEBUG is unset", async () => {
			delete process.env.RUNNER_DEBUG;
			const result = await run(Effect.flatMap(ActionEnvironment, (svc) => svc.isDebug));
			expect(result).toBe(false);
		});

		it("is false when RUNNER_DEBUG=0", async () => {
			process.env.RUNNER_DEBUG = "0";
			const result = await run(Effect.flatMap(ActionEnvironment, (svc) => svc.isDebug));
			expect(result).toBe(false);
		});
	});

	describe("payload / repo / issue", () => {
		let tmp: string;
		const restore: Record<string, string | undefined> = {};

		const overrideEnv = (vars: Record<string, string | undefined>) => {
			for (const [key, value] of Object.entries(vars)) {
				if (!(key in restore)) restore[key] = process.env[key];
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		};

		beforeEach(() => {
			tmp = mkdtempSync(join(tmpdir(), "action-env-"));
		});

		afterEach(() => {
			for (const [key, value] of Object.entries(restore)) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
				delete restore[key];
			}
			rmSync(tmp, { recursive: true, force: true });
		});

		it("payload parses GITHUB_EVENT_PATH JSON", async () => {
			const eventFile = join(tmp, "event.json");
			writeFileSync(eventFile, JSON.stringify({ pull_request: { number: 9 } }));
			overrideEnv({ GITHUB_EVENT_PATH: eventFile });
			const result = await runFs(Effect.flatMap(ActionEnvironment, (svc) => svc.payload));
			expect(result.pull_request?.number).toBe(9);
		});

		it("payload is empty when GITHUB_EVENT_PATH is unset", async () => {
			overrideEnv({ GITHUB_EVENT_PATH: undefined });
			const result = await runFs(Effect.flatMap(ActionEnvironment, (svc) => svc.payload));
			expect(result).toEqual({});
		});

		it("payload is empty (no throw) when the file is missing", async () => {
			overrideEnv({ GITHUB_EVENT_PATH: join(tmp, "does-not-exist.json") });
			const result = await runFs(Effect.flatMap(ActionEnvironment, (svc) => svc.payload));
			expect(result).toEqual({});
		});

		it("payload fails ActionEnvironmentError on malformed JSON", async () => {
			const eventFile = join(tmp, "bad.json");
			writeFileSync(eventFile, "{ not json");
			overrideEnv({ GITHUB_EVENT_PATH: eventFile });
			const exit = await runFsExit(Effect.flatMap(ActionEnvironment, (svc) => svc.payload));
			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				const cause = JSON.stringify(exit.cause);
				expect(cause).toContain("ActionEnvironmentError");
				expect(cause).toContain("GITHUB_EVENT_PATH");
			}
		});

		it("repo reads GITHUB_REPOSITORY first", async () => {
			overrideEnv({ GITHUB_REPOSITORY: "o/r", GITHUB_EVENT_PATH: undefined });
			const result = await runFs(Effect.flatMap(ActionEnvironment, (svc) => svc.repo));
			expect(result).toEqual({ owner: "o", repo: "r" });
		});

		it("repo falls back to payload.repository", async () => {
			const eventFile = join(tmp, "event.json");
			writeFileSync(eventFile, JSON.stringify({ repository: { name: "rn", owner: { login: "ol" } } }));
			overrideEnv({ GITHUB_REPOSITORY: undefined, GITHUB_EVENT_PATH: eventFile });
			const result = await runFs(Effect.flatMap(ActionEnvironment, (svc) => svc.repo));
			expect(result).toEqual({ owner: "ol", repo: "rn" });
		});

		it("repo fails when neither GITHUB_REPOSITORY nor payload.repository is available", async () => {
			overrideEnv({ GITHUB_REPOSITORY: undefined, GITHUB_EVENT_PATH: undefined });
			const exit = await runFsExit(Effect.flatMap(ActionEnvironment, (svc) => svc.repo));
			expect(exit._tag).toBe("Failure");
			if (exit._tag === "Failure") {
				expect(JSON.stringify(exit.cause)).toContain("GITHUB_REPOSITORY");
			}
		});

		it("issue resolves number from issue", async () => {
			const eventFile = join(tmp, "event.json");
			writeFileSync(eventFile, JSON.stringify({ issue: { number: 1 } }));
			overrideEnv({ GITHUB_REPOSITORY: "o/r", GITHUB_EVENT_PATH: eventFile });
			const result = await runFs(Effect.flatMap(ActionEnvironment, (svc) => svc.issue));
			expect(result).toEqual({ owner: "o", repo: "r", number: 1 });
		});

		it("issue resolves number from pull_request", async () => {
			const eventFile = join(tmp, "event.json");
			writeFileSync(eventFile, JSON.stringify({ pull_request: { number: 2 } }));
			overrideEnv({ GITHUB_REPOSITORY: "o/r", GITHUB_EVENT_PATH: eventFile });
			const result = await runFs(Effect.flatMap(ActionEnvironment, (svc) => svc.issue));
			expect(result.number).toBe(2);
		});

		it("issue resolves number from top-level payload.number", async () => {
			const eventFile = join(tmp, "event.json");
			writeFileSync(eventFile, JSON.stringify({ number: 3 }));
			overrideEnv({ GITHUB_REPOSITORY: "o/r", GITHUB_EVENT_PATH: eventFile });
			const result = await runFs(Effect.flatMap(ActionEnvironment, (svc) => svc.issue));
			expect(result.number).toBe(3);
		});

		it("issue fails when no number is present", async () => {
			overrideEnv({ GITHUB_REPOSITORY: "o/r", GITHUB_EVENT_PATH: undefined });
			const exit = await runFsExit(Effect.flatMap(ActionEnvironment, (svc) => svc.issue));
			expect(exit._tag).toBe("Failure");
		});
	});
});
