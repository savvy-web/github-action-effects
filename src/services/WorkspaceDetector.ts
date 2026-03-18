import type { Effect } from "effect";
import { Context } from "effect";
import type { WorkspaceDetectorError } from "../errors/WorkspaceDetectorError.js";
import type { WorkspaceInfo, WorkspacePackage } from "../schemas/Workspace.js";

/**
 * Service for workspace/monorepo detection.
 *
 * @public
 */
export class WorkspaceDetector extends Context.Tag("github-action-effects/WorkspaceDetector")<
	WorkspaceDetector,
	{
		readonly detect: () => Effect.Effect<WorkspaceInfo, WorkspaceDetectorError>;
		readonly listPackages: () => Effect.Effect<Array<WorkspacePackage>, WorkspaceDetectorError>;
		readonly getPackage: (nameOrPath: string) => Effect.Effect<WorkspacePackage, WorkspaceDetectorError>;
	}
>() {}
