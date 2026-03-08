import { Effect, Layer, Option } from "effect";
import { ActionEnvironmentError } from "../errors/ActionEnvironmentError.js";
import type { GitHubContext, RunnerContext } from "../schemas/Environment.js";
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

export const ActionEnvironmentLive: Layer.Layer<ActionEnvironment> = Layer.succeed(ActionEnvironment, {
	get: (name) => readEnv(name).pipe(Effect.withSpan("ActionEnvironment.get", { attributes: { "env.name": name } })),
	getOptional: (name) =>
		readOptionalEnv(name).pipe(Effect.withSpan("ActionEnvironment.getOptional", { attributes: { "env.name": name } })),
	github: buildGitHubContext.pipe(Effect.withSpan("ActionEnvironment.github")),
	runner: buildRunnerContext.pipe(Effect.withSpan("ActionEnvironment.runner")),
});
