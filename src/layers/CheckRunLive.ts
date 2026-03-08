import { Effect, Layer } from "effect";
import { CheckRunError } from "../errors/CheckRunError.js";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import type { CheckRunConclusion, CheckRunOutput } from "../services/CheckRun.js";
import { CheckRun } from "../services/CheckRun.js";
import { GitHubClient } from "../services/GitHubClient.js";

const mapError =
	(name: string, operation: "create" | "update" | "complete") =>
	(error: GitHubClientError): CheckRunError =>
		new CheckRunError({ name, operation, reason: error.reason });

/** Minimal Octokit shape for checks API calls. */
interface OctokitChecks {
	readonly rest: {
		readonly checks: {
			readonly create: (args: Record<string, unknown>) => Promise<{ data: { id: number } }>;
			readonly update: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
		};
	};
}

const asChecks = (octokit: unknown): OctokitChecks => octokit as OctokitChecks;

const formatOutput = (output: CheckRunOutput) => ({
	title: output.title,
	summary: output.summary,
	...(output.text !== undefined ? { text: output.text } : {}),
	...(output.annotations !== undefined && output.annotations.length > 0
		? { annotations: [...output.annotations].slice(0, 50) }
		: {}),
});

export const CheckRunLive: Layer.Layer<CheckRun, never, GitHubClient> = Layer.effect(
	CheckRun,
	Effect.map(GitHubClient, (client) => {
		const createCheckRun = (name: string, headSha: string): Effect.Effect<number, CheckRunError> =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("checks.create", (octokit) =>
					asChecks(octokit).rest.checks.create({
						owner,
						repo,
						name,
						head_sha: headSha,
						status: "in_progress",
						started_at: new Date().toISOString(),
					}),
				),
			).pipe(
				Effect.map((data) => (data as { id: number }).id),
				Effect.mapError(mapError(name, "create")),
			);

		const completeCheckRun = (
			name: string,
			checkRunId: number,
			conclusion: CheckRunConclusion,
			output?: CheckRunOutput,
		): Effect.Effect<void, CheckRunError> =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("checks.update", (octokit) =>
					asChecks(octokit).rest.checks.update({
						owner,
						repo,
						check_run_id: checkRunId,
						status: "completed",
						conclusion,
						completed_at: new Date().toISOString(),
						...(output !== undefined ? { output: formatOutput(output) } : {}),
					}),
				),
			).pipe(Effect.asVoid, Effect.mapError(mapError(name, "complete")));

		return {
			create: createCheckRun,

			update: (checkRunId, output) =>
				Effect.flatMap(client.repo, ({ owner, repo }) =>
					client.rest("checks.update", (octokit) =>
						asChecks(octokit).rest.checks.update({
							owner,
							repo,
							check_run_id: checkRunId,
							output: formatOutput(output),
						}),
					),
				).pipe(Effect.asVoid, Effect.mapError(mapError("", "update"))),

			complete: (checkRunId, conclusion, output) => completeCheckRun("", checkRunId, conclusion, output),

			withCheckRun: (name, headSha, effect) =>
				Effect.flatMap(createCheckRun(name, headSha), (checkRunId) =>
					Effect.matchCauseEffect(effect(checkRunId), {
						onFailure: (cause) =>
							completeCheckRun(name, checkRunId, "failure").pipe(Effect.flatMap(() => Effect.failCause(cause))),
						onSuccess: (result) => completeCheckRun(name, checkRunId, "success").pipe(Effect.map(() => result)),
					}),
				),
		};
	}),
);
