import type { Effect } from "effect";
import { Context } from "effect";
import type { WorkspaceDetectorError } from "../errors/WorkspaceDetectorError.js";
import type { WorkspaceInfo, WorkspacePackage } from "../schemas/Workspace.js";

/**
 * Service interface for workspace/monorepo detection.
 *
 * @public
 */
export interface WorkspaceDetector {
	readonly detect: () => Effect.Effect<WorkspaceInfo, WorkspaceDetectorError>;
	readonly listPackages: () => Effect.Effect<Array<WorkspacePackage>, WorkspaceDetectorError>;
	readonly getPackage: (nameOrPath: string) => Effect.Effect<WorkspacePackage, WorkspaceDetectorError>;
}

/**
 * WorkspaceDetector tag for dependency injection.
 *
 * @public
 */
export const WorkspaceDetector = Context.GenericTag<WorkspaceDetector>("WorkspaceDetector");
