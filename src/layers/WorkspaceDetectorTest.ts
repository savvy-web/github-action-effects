import { Effect, Layer } from "effect";
import { WorkspaceDetectorError } from "../errors/WorkspaceDetectorError.js";
import type { WorkspaceInfo, WorkspacePackage } from "../schemas/Workspace.js";
import type { WorkspaceDetector } from "../services/WorkspaceDetector.js";
import { WorkspaceDetector as WorkspaceDetectorTag } from "../services/WorkspaceDetector.js";

/**
 * Test state for WorkspaceDetector.
 *
 * @public
 */
export interface WorkspaceDetectorTestState {
	readonly info: WorkspaceInfo;
	readonly packages: Array<WorkspacePackage>;
}

const makeTestClient = (state: WorkspaceDetectorTestState): WorkspaceDetector => ({
	detect: () => Effect.succeed(state.info),
	listPackages: () => Effect.succeed(state.packages),
	getPackage: (nameOrPath: string) => {
		const found = state.packages.find((p) => p.name === nameOrPath || p.path === nameOrPath);
		if (!found) {
			return Effect.fail(
				new WorkspaceDetectorError({
					operation: "get",
					reason: `Package "${nameOrPath}" not found in test state`,
				}),
			);
		}
		return Effect.succeed(found);
	},
});

/**
 * Test implementation for WorkspaceDetector.
 *
 * @public
 */
export const WorkspaceDetectorTest = {
	layer: (state: WorkspaceDetectorTestState): Layer.Layer<WorkspaceDetector> =>
		Layer.succeed(WorkspaceDetectorTag, makeTestClient(state)),

	empty: (): Layer.Layer<WorkspaceDetector> =>
		Layer.succeed(
			WorkspaceDetectorTag,
			makeTestClient({
				info: { root: ".", type: "single", patterns: ["."] },
				packages: [],
			}),
		),
} as const;
