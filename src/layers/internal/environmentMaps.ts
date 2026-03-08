/**
 * Shared environment variable name mappings for ActionEnvironment layers.
 *
 * @internal
 */

/** Maps GitHubContext field names to GITHUB_* environment variable names. */
export const GITHUB_ENV_MAP: Record<string, string> = {
	sha: "GITHUB_SHA",
	ref: "GITHUB_REF",
	repository: "GITHUB_REPOSITORY",
	repositoryOwner: "GITHUB_REPOSITORY_OWNER",
	workspace: "GITHUB_WORKSPACE",
	eventName: "GITHUB_EVENT_NAME",
	eventPath: "GITHUB_EVENT_PATH",
	runId: "GITHUB_RUN_ID",
	runNumber: "GITHUB_RUN_NUMBER",
	actor: "GITHUB_ACTOR",
	serverUrl: "GITHUB_SERVER_URL",
	apiUrl: "GITHUB_API_URL",
	graphqlUrl: "GITHUB_GRAPHQL_URL",
	action: "GITHUB_ACTION",
	job: "GITHUB_JOB",
	workflow: "GITHUB_WORKFLOW",
};

/** Maps RunnerContext field names to RUNNER_* environment variable names. */
export const RUNNER_ENV_MAP: Record<string, string> = {
	os: "RUNNER_OS",
	arch: "RUNNER_ARCH",
	name: "RUNNER_NAME",
	temp: "RUNNER_TEMP",
	toolCache: "RUNNER_TOOL_CACHE",
};
