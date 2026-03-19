import { Effect, Layer, Schedule } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { WorkflowDispatchError } from "../errors/WorkflowDispatchError.js";
import { GitHubClient } from "../services/GitHubClient.js";
import type { PollOptions, WorkflowRunStatus } from "../services/WorkflowDispatch.js";
import { WorkflowDispatch } from "../services/WorkflowDispatch.js";

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 300_000;

/** Sentinel operation for retry-eligible "not yet completed" poll results. */
const POLL_PENDING = "poll-pending" as const;

const mapError =
	(workflow: string, operation: "dispatch" | "poll" | "poll-pending" | "status") =>
	(error: GitHubClientError): WorkflowDispatchError =>
		new WorkflowDispatchError({ workflow, operation, reason: error.reason });

/** Minimal Octokit shape for actions API calls. */
interface OctokitActions {
	readonly rest: {
		readonly actions: {
			readonly createWorkflowDispatch: (args: Record<string, unknown>) => Promise<{ data: unknown }>;
			readonly listWorkflowRuns: (args: Record<string, unknown>) => Promise<{
				data: {
					workflow_runs: ReadonlyArray<{
						id: number;
						status: string;
						conclusion: string | null;
						created_at: string;
					}>;
				};
			}>;
			readonly getWorkflowRun: (args: Record<string, unknown>) => Promise<{
				data: { status: string; conclusion: string | null };
			}>;
		};
	};
}

const asActions = (octokit: unknown): OctokitActions => octokit as OctokitActions;

export const WorkflowDispatchLive: Layer.Layer<WorkflowDispatch, never, GitHubClient> = Layer.effect(
	WorkflowDispatch,
	Effect.map(GitHubClient, (client) => {
		const dispatchWorkflow = (
			workflow: string,
			ref: string,
			inputs?: Record<string, string>,
		): Effect.Effect<void, WorkflowDispatchError> =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("actions.createWorkflowDispatch", (octokit) =>
					asActions(octokit).rest.actions.createWorkflowDispatch({
						owner,
						repo,
						workflow_id: workflow,
						ref,
						...(inputs !== undefined ? { inputs } : {}),
					}),
				),
			).pipe(Effect.asVoid, Effect.mapError(mapError(workflow, "dispatch")));

		const getRunStatus = (runId: number): Effect.Effect<WorkflowRunStatus, WorkflowDispatchError> =>
			Effect.flatMap(client.repo, ({ owner, repo }) =>
				client.rest("actions.getWorkflowRun", (octokit) =>
					asActions(octokit).rest.actions.getWorkflowRun({
						owner,
						repo,
						run_id: runId,
					}),
				),
			).pipe(
				Effect.map((data) => {
					const typed = data as { status: string; conclusion: string | null };
					return { status: typed.status, conclusion: typed.conclusion };
				}),
				Effect.mapError(mapError(String(runId), "status")),
			);

		const dispatchAndWait = (
			workflow: string,
			ref: string,
			inputs?: Record<string, string>,
			pollOptions?: PollOptions,
		): Effect.Effect<string, WorkflowDispatchError> => {
			const intervalMs = pollOptions?.intervalMs ?? DEFAULT_INTERVAL_MS;
			const timeoutMs = pollOptions?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
			const maxAttempts = Math.ceil(timeoutMs / intervalMs);

			return Effect.gen(function* () {
				const dispatchedAt = new Date().toISOString();

				yield* dispatchWorkflow(workflow, ref, inputs);

				const { owner, repo } = yield* client.repo.pipe(Effect.mapError(mapError(workflow, "poll")));

				const pollOnce: Effect.Effect<string, WorkflowDispatchError> = client
					.rest("actions.listWorkflowRuns", (octokit) =>
						asActions(octokit).rest.actions.listWorkflowRuns({
							owner,
							repo,
							workflow_id: workflow,
							created: `>=${dispatchedAt}`,
							per_page: 10,
						}),
					)
					.pipe(
						Effect.mapError(mapError(workflow, "poll")),
						Effect.flatMap((data) => {
							const typed = data as {
								workflow_runs: ReadonlyArray<{
									id: number;
									status: string;
									conclusion: string | null;
									created_at: string;
								}>;
							};
							const runs = typed.workflow_runs.filter((r) => r.created_at >= dispatchedAt);
							const completed = runs.find((r) => r.status === "completed");
							if (completed?.conclusion !== undefined && completed.conclusion !== null) {
								return Effect.succeed(completed.conclusion);
							}
							return Effect.fail(
								new WorkflowDispatchError({
									workflow,
									operation: POLL_PENDING,
									reason: "Run not yet completed",
								}),
							);
						}),
					);

				return yield* pollOnce.pipe(
					Effect.retry({
						while: (error) => error.operation === POLL_PENDING,
						schedule: Schedule.spaced(intervalMs).pipe(Schedule.intersect(Schedule.recurs(maxAttempts))),
					}),
					Effect.catchAll((error) => {
						if (error.operation === POLL_PENDING) {
							return Effect.fail(
								new WorkflowDispatchError({
									workflow,
									operation: "poll",
									reason: `Timed out after ${timeoutMs}ms waiting for workflow to complete`,
								}),
							);
						}
						return Effect.fail(error);
					}),
				);
			});
		};

		return {
			dispatch: dispatchWorkflow,
			dispatchAndWait,
			getRunStatus,
		};
	}),
);
