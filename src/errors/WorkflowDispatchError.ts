import { Data } from "effect";

/**
 * Base class for WorkflowDispatchError.
 *
 * @internal
 */
export const WorkflowDispatchErrorBase = Data.TaggedError("WorkflowDispatchError");

/**
 * Error from workflow dispatch operations.
 */
export class WorkflowDispatchError extends WorkflowDispatchErrorBase<{
	/** The workflow file or ID. */
	readonly workflow: string;

	/** The operation that failed. */
	readonly operation: "dispatch" | "poll" | "poll-pending" | "status";

	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
