import { Effect, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionEnvironment } from "../services/ActionEnvironment.js";
import { ActionEnvironmentLive } from "./ActionEnvironmentLive.js";

const run = <A, E>(effect: Effect.Effect<A, E, ActionEnvironment>) =>
	Effect.runPromise(Effect.provide(effect, ActionEnvironmentLive));

const runExit = <A, E>(effect: Effect.Effect<A, E, ActionEnvironment>) =>
	Effect.runPromise(Effect.exit(Effect.provide(effect, ActionEnvironmentLive)));

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
});
