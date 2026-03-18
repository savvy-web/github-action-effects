import type { Effect } from "effect";
import { Context } from "effect";
import type { WorkflowDispatchError } from "../errors/WorkflowDispatchError.js";

/**
 * Status of a workflow run.
 *
 * @public
 */
export interface WorkflowRunStatus {
	readonly status: string;
	readonly conclusion: string | null;
}

/**
 * Options for polling a dispatched workflow run.
 *
 * @public
 */
export interface PollOptions {
	/** Polling interval in milliseconds. Default: 10000 (10s). */
	readonly intervalMs?: number;
	/** Timeout in milliseconds. Default: 300000 (5min). */
	readonly timeoutMs?: number;
}

/**
 * Service for triggering and monitoring GitHub Actions workflow runs.
 *
 * @public
 */
export class WorkflowDispatch extends Context.Tag("github-action-effects/WorkflowDispatch")<
	WorkflowDispatch,
	{
		/** Trigger a workflow run. */
		readonly dispatch: (
			workflow: string,
			ref: string,
			inputs?: Record<string, string>,
		) => Effect.Effect<void, WorkflowDispatchError>;

		/** Trigger a workflow run and poll until completion. Returns the run conclusion. */
		readonly dispatchAndWait: (
			workflow: string,
			ref: string,
			inputs?: Record<string, string>,
			pollOptions?: PollOptions,
		) => Effect.Effect<string, WorkflowDispatchError>;

		/** Get the status of a workflow run by ID. */
		readonly getRunStatus: (runId: number) => Effect.Effect<WorkflowRunStatus, WorkflowDispatchError>;
	}
>() {}
