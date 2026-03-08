import { Schema } from "effect";

/**
 * GitHub Actions context derived from GITHUB_* environment variables.
 *
 * @public
 */
export const GitHubContext = Schema.Struct({
	sha: Schema.String,
	ref: Schema.String,
	repository: Schema.String,
	repositoryOwner: Schema.String,
	workspace: Schema.String,
	eventName: Schema.String,
	eventPath: Schema.String,
	runId: Schema.String,
	runNumber: Schema.String,
	actor: Schema.String,
	serverUrl: Schema.String,
	apiUrl: Schema.String,
	graphqlUrl: Schema.String,
	action: Schema.String,
	job: Schema.String,
	workflow: Schema.String,
}).annotations({ identifier: "GitHubContext" });

/** Inferred type for GitHubContext. */
export type GitHubContext = typeof GitHubContext.Type;

/**
 * Runner context derived from RUNNER_* environment variables.
 *
 * @public
 */
export const RunnerContext = Schema.Struct({
	os: Schema.String,
	arch: Schema.String,
	name: Schema.String,
	temp: Schema.String,
	toolCache: Schema.String,
	debug: Schema.Boolean,
}).annotations({ identifier: "RunnerContext" });

/** Inferred type for RunnerContext. */
export type RunnerContext = typeof RunnerContext.Type;
