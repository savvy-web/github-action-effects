import { Data } from "effect";

/**
 * Error from workspace detection operations.
 */
export class WorkspaceDetectorError extends Data.TaggedError("WorkspaceDetectorError")<{
	readonly operation: "detect" | "list" | "get";
	readonly reason: string;
}> {}
