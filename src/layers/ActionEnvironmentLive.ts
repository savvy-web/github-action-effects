import { FileSystem } from "@effect/platform";
import { Effect, Layer, Option, Schema } from "effect";
import { ActionEnvironmentError } from "../errors/ActionEnvironmentError.js";
import type { GitHubContext, RunnerContext } from "../schemas/Environment.js";
import { WebhookPayload } from "../schemas/EventPayload.js";
import { ActionEnvironment } from "../services/ActionEnvironment.js";
import { GITHUB_ENV_MAP } from "./internal/environmentMaps.js";

const readEnv = (name: string): Effect.Effect<string, ActionEnvironmentError> =>
	Effect.sync(() => process.env[name]).pipe(
		Effect.flatMap((value) =>
			value !== undefined && value !== ""
				? Effect.succeed(value)
				: Effect.fail(
						new ActionEnvironmentError({
							variable: name,
							reason: `Environment variable "${name}" is not set`,
						}),
					),
		),
	);

const readOptionalEnv = (name: string): Effect.Effect<Option.Option<string>> =>
	Effect.sync(() => process.env[name]).pipe(
		Effect.map((value) => (value !== undefined && value !== "" ? Option.some(value) : Option.none())),
	);

const buildGitHubContext: Effect.Effect<GitHubContext, ActionEnvironmentError> = Effect.all(
	Object.fromEntries(Object.entries(GITHUB_ENV_MAP).map(([key, envVar]) => [key, readEnv(envVar)])) as {
		[K in keyof GitHubContext]: Effect.Effect<string, ActionEnvironmentError>;
	},
) as Effect.Effect<GitHubContext, ActionEnvironmentError>;

const buildRunnerContext: Effect.Effect<RunnerContext, ActionEnvironmentError> = Effect.all({
	os: readEnv("RUNNER_OS"),
	arch: readEnv("RUNNER_ARCH"),
	name: readEnv("RUNNER_NAME"),
	temp: readEnv("RUNNER_TEMP"),
	toolCache: readEnv("RUNNER_TOOL_CACHE"),
	debug: Effect.sync(() => process.env.RUNNER_DEBUG === "1"),
});

const EMPTY_PAYLOAD: WebhookPayload = {};

const decodePayload = (raw: string): Effect.Effect<WebhookPayload, ActionEnvironmentError> =>
	Effect.try({
		try: () => JSON.parse(raw) as unknown,
		catch: (error) =>
			new ActionEnvironmentError({
				variable: "GITHUB_EVENT_PATH",
				reason: `Failed to parse event payload JSON: ${error instanceof Error ? error.message : String(error)}`,
			}),
	}).pipe(
		Effect.flatMap((data) =>
			Schema.decodeUnknown(WebhookPayload, { onExcessProperty: "preserve" })(data).pipe(
				Effect.mapError(
					(error) =>
						new ActionEnvironmentError({
							variable: "GITHUB_EVENT_PATH",
							reason: `Event payload did not match the expected shape: ${error.message}`,
						}),
				),
			),
		),
	);

/**
 * Read and decode the `GITHUB_EVENT_PATH` payload. Degrades to an empty payload
 * (no failure) when the env var is unset or the file is missing — matching
 * `@actions/github`, which warns and uses `{}`.
 */
const readPayload: Effect.Effect<WebhookPayload, ActionEnvironmentError, FileSystem.FileSystem> = Effect.gen(
	function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = process.env.GITHUB_EVENT_PATH;
		if (path === undefined || path === "") {
			return EMPTY_PAYLOAD;
		}
		const exists = yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false));
		if (!exists) {
			yield* Effect.logDebug(`GITHUB_EVENT_PATH ${path} does not exist; using an empty payload`);
			return EMPTY_PAYLOAD;
		}
		const raw = yield* fs.readFileString(path).pipe(
			Effect.mapError(
				(error) =>
					new ActionEnvironmentError({
						variable: "GITHUB_EVENT_PATH",
						reason: `Failed to read event payload file: ${error.message}`,
					}),
			),
		);
		return yield* decodePayload(raw);
	},
);

const repoFromEnvOrPayload = (
	payload: WebhookPayload,
): Effect.Effect<{ owner: string; repo: string }, ActionEnvironmentError> => {
	const repository = process.env.GITHUB_REPOSITORY;
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

const issueNumber = (payload: WebhookPayload): number | undefined =>
	payload.issue?.number ?? payload.pull_request?.number ?? payload.number;

const buildPayload: Effect.Effect<WebhookPayload, ActionEnvironmentError, FileSystem.FileSystem> = readPayload;

const buildRepo: Effect.Effect<{ owner: string; repo: string }, ActionEnvironmentError, FileSystem.FileSystem> =
	readPayload.pipe(Effect.flatMap(repoFromEnvOrPayload));

const buildIssue: Effect.Effect<
	{ owner: string; repo: string; number: number },
	ActionEnvironmentError,
	FileSystem.FileSystem
> = readPayload.pipe(
	Effect.flatMap((payload) =>
		repoFromEnvOrPayload(payload).pipe(
			Effect.flatMap((repo) => {
				const number = issueNumber(payload);
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
		),
	),
);

export const ActionEnvironmentLive: Layer.Layer<ActionEnvironment> = Layer.succeed(ActionEnvironment, {
	get: (name) => readEnv(name),
	getOptional: (name) => readOptionalEnv(name),
	github: buildGitHubContext,
	runner: buildRunnerContext,
	isDebug: Effect.sync(() => process.env.RUNNER_DEBUG === "1"),
	payload: buildPayload,
	repo: buildRepo,
	issue: buildIssue,
});
