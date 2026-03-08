import { Effect, Layer, Option } from "effect";
import { ActionEnvironmentError } from "../errors/ActionEnvironmentError.js";
import type { GitHubContext, RunnerContext } from "../schemas/Environment.js";
import { ActionEnvironment } from "../services/ActionEnvironment.js";
import { GITHUB_ENV_MAP, RUNNER_ENV_MAP } from "./internal/environmentMaps.js";

const defaultGitHub: GitHubContext = {
	sha: "abc1234567890def",
	ref: "refs/heads/main",
	repository: "owner/repo",
	repositoryOwner: "owner",
	workspace: "/home/runner/work/repo/repo",
	eventName: "push",
	eventPath: "/home/runner/work/_temp/_github_workflow/event.json",
	runId: "12345",
	runNumber: "1",
	actor: "test-user",
	serverUrl: "https://github.com",
	apiUrl: "https://api.github.com",
	graphqlUrl: "https://api.github.com/graphql",
	action: "test-action",
	job: "test-job",
	workflow: "Test Workflow",
};

const defaultRunner: RunnerContext = {
	os: "Linux",
	arch: "X64",
	name: "test-runner",
	temp: "/tmp",
	toolCache: "/opt/hostedtoolcache",
	debug: false,
};

/**
 * Test implementation for ActionEnvironment.
 *
 * @public
 */
export const ActionEnvironmentTest = {
	/** Create test layer from env record. Builds contexts from GITHUB_* /RUNNER_* keys. */
	layer: (env: Record<string, string>): Layer.Layer<ActionEnvironment> =>
		Layer.succeed(ActionEnvironment, {
			get: (name: string) => {
				const value = env[name];
				if (value === undefined || value === "") {
					return Effect.fail(
						new ActionEnvironmentError({
							variable: name,
							reason: `Environment variable "${name}" is not set`,
						}),
					);
				}
				return Effect.succeed(value);
			},

			getOptional: (name: string) => {
				const value = env[name];
				return Effect.succeed(value !== undefined && value !== "" ? Option.some(value) : Option.none());
			},

			github: Effect.succeed({
				...defaultGitHub,
				...Object.fromEntries(
					Object.entries(GITHUB_ENV_MAP)
						.filter(([, envVar]) => env[envVar] !== undefined)
						.map(([key, envVar]) => [key, env[envVar]]),
				),
			} as GitHubContext),

			runner: Effect.succeed({
				...defaultRunner,
				...Object.fromEntries(
					Object.entries(RUNNER_ENV_MAP)
						.filter(([, envVar]) => env[envVar] !== undefined)
						.map(([key, envVar]) => [key, env[envVar]]),
				),
				debug: env.RUNNER_DEBUG === "1",
			} as RunnerContext),
		}),

	/** Create test layer with default GitHub Actions environment. */
	empty: (): Layer.Layer<ActionEnvironment> =>
		Layer.succeed(ActionEnvironment, {
			get: (name: string) =>
				Effect.fail(
					new ActionEnvironmentError({
						variable: name,
						reason: `Environment variable "${name}" is not set`,
					}),
				),
			getOptional: (_name: string) => Effect.succeed(Option.none()),
			github: Effect.succeed(defaultGitHub),
			runner: Effect.succeed(defaultRunner),
		}),
} as const;
