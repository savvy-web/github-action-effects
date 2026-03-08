import { Data } from "effect";

/**
 * Base class for WorkspaceDetectorError.
 *
 * @internal
 */
export const WorkspaceDetectorErrorBase = Data.TaggedError("WorkspaceDetectorError");

/**
 * Error from workspace detection operations.
 */
export class WorkspaceDetectorError extends WorkspaceDetectorErrorBase<{
	readonly operation: "detect" | "list" | "get";
	readonly reason: string;
}> {}
