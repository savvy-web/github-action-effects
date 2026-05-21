import { Effect, Layer, Option } from "effect";
import { ActionEnvironmentError } from "../errors/ActionEnvironmentError.js";
import type { GitHubContext, RunnerContext } from "../schemas/Environment.js";
import type { WebhookPayload } from "../schemas/EventPayload.js";
import { ActionEnvironment } from "../services/ActionEnvironment.js";
import { GITHUB_ENV_MAP, RUNNER_ENV_MAP } from "./internal/environmentMaps.js";

const repoFromEnvOrPayload = (
	repository: string | undefined,
	payload: WebhookPayload,
): Effect.Effect<{ owner: string; repo: string }, ActionEnvironmentError> => {
	if (repository !== undefined && repository !== "") {
		const [owner, repo] = repository.split("/");
		if (owner !== undefined && repo !== undefined) {
			return Effect.succeed({ owner, repo });
		}
	}
	if (payload.repository !== undefined) {
		return Effect.succeed({
			owner: payload.repository.owner.login,
			repo: payload.repository.name,
		});
	}
	return Effect.fail(
		new ActionEnvironmentError({
			variable: "GITHUB_REPOSITORY",
			reason:
				"context.repo requires a GITHUB_REPOSITORY environment variable like 'owner/repo' or a repository in the event payload",
		}),
	);
};

const issueFromPayload = (
	repository: string | undefined,
	payload: WebhookPayload,
): Effect.Effect<{ owner: string; repo: string; number: number }, ActionEnvironmentError> =>
	repoFromEnvOrPayload(repository, payload).pipe(
		Effect.flatMap((repo) => {
			const number = payload.issue?.number ?? payload.pull_request?.number ?? payload.number;
			if (number === undefined) {
				return Effect.fail(
					new ActionEnvironmentError({
						variable: "GITHUB_EVENT_PATH",
						reason: "context.issue requires an issue, pull_request, or top-level number in the event payload",
					}),
				);
			}
			return Effect.succeed({ ...repo, number });
		}),
	);

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
	/**
	 * Create test layer from an env record. Builds contexts from
	 * GITHUB_* / RUNNER_* keys. An optional `payload` seeds `payload` / `repo`
	 * / `issue` without a real event file.
	 */
	layer: (env: Record<string, string>, payload: WebhookPayload = {}): Layer.Layer<ActionEnvironment> =>
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

			isDebug: Effect.succeed(env.RUNNER_DEBUG === "1"),
			payload: Effect.succeed(payload),
			repo: repoFromEnvOrPayload(env.GITHUB_REPOSITORY, payload),
			issue: issueFromPayload(env.GITHUB_REPOSITORY, payload),
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
			isDebug: Effect.succeed(false),
			payload: Effect.succeed({}),
			// `.empty()` derives repo from the default `owner/repo`; issue fails
			// (no number seeded).
			repo: repoFromEnvOrPayload(defaultGitHub.repository, {}),
			issue: issueFromPayload(defaultGitHub.repository, {}),
		}),
} as const;
