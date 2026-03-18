import { Data } from "effect";

/**
 * Error from workflow dispatch operations.
 */
export class WorkflowDispatchError extends Data.TaggedError("WorkflowDispatchError")<{
	/** The workflow file or ID. */
	readonly workflow: string;

	/** The operation that failed. */
	readonly operation: "dispatch" | "poll" | "poll-pending" | "status";

	/** Human-readable description of what went wrong. */
	readonly reason: string;
}> {}
