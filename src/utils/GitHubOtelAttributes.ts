const ENV_MAP: Array<[envVar: string, attribute: string]> = [
	["GITHUB_WORKFLOW", "cicd.pipeline.name"],
	["GITHUB_RUN_ID", "cicd.pipeline.run.id"],
	["GITHUB_RUN_NUMBER", "cicd.pipeline.run.counter"],
	["GITHUB_REF", "vcs.ref.head.name"],
	["GITHUB_SHA", "vcs.ref.head.revision"],
	["GITHUB_ACTOR", "enduser.id"],
	["RUNNER_NAME", "cicd.worker.name"],
	["RUNNER_OS", "cicd.worker.os"],
];

/**
 * Namespace for mapping GitHub Actions environment variables to OpenTelemetry
 * semantic convention resource attributes.
 *
 * @public
 */
export const GitHubOtelAttributes = {
	/**
	 * Read GITHUB_* and RUNNER_* environment variables and map them to
	 * OpenTelemetry semantic convention resource attributes.
	 *
	 * Only includes attributes whose environment variables are set.
	 */
	fromEnvironment: (env: Record<string, string | undefined> = process.env): Record<string, string> => {
		const attrs: Record<string, string> = {};
		for (const [envVar, attr] of ENV_MAP) {
			const value = env[envVar];
			if (value !== undefined && value !== "") {
				attrs[attr] = value;
			}
		}
		// Compose vcs.repository.url.full from two env vars
		const serverUrl = env.GITHUB_SERVER_URL;
		const repository = env.GITHUB_REPOSITORY;
		if (serverUrl && repository) {
			attrs["vcs.repository.url.full"] = `${serverUrl}/${repository}`;
		}
		return attrs;
	},
} as const;
