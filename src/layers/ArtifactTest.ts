import { Effect, Layer, Option } from "effect";
import { ArtifactError } from "../errors/ArtifactError.js";
import type { ArtifactItem } from "../services/Artifact.js";
import { Artifact } from "../services/Artifact.js";

/**
 * In-memory artifact state for testing.
 *
 * @remarks
 * `artifacts` maps artifact name → metadata; `uploaded` records the file list
 * each upload carried so a test can assert what was uploaded without touching
 * the network or disk. `nextId` is the auto-incrementing artifact id.
 *
 * @public
 */
export interface ArtifactTestState {
	readonly artifacts: Map<string, ArtifactItem>;
	readonly uploaded: Map<string, ReadonlyArray<string>>;
	nextId: number;
}

const makeTestArtifact = (state: ArtifactTestState): typeof Artifact.Service => ({
	uploadArtifact: (name, files, _rootDirectory, _options) =>
		Effect.sync(() => {
			const id = state.nextId++;
			const size = files.length;
			state.artifacts.set(name, { id, name, size, createdAt: new Date(0).toISOString() });
			state.uploaded.set(name, [...files]);
			return { id, size };
		}),

	listArtifacts: (_findBy) => Effect.sync(() => [...state.artifacts.values()]),

	getArtifact: (name, _findBy) =>
		Effect.sync((): Option.Option<ArtifactItem> => {
			const item = state.artifacts.get(name);
			return item ? Option.some(item) : Option.none();
		}),

	downloadArtifact: (artifactId, options, _findBy) =>
		Effect.sync(() => ({ downloadPath: options?.path ?? `/tmp/artifact-${artifactId}` })),

	deleteArtifact: (name, _findBy) =>
		Effect.gen(function* () {
			const item = state.artifacts.get(name);
			if (!item) {
				return yield* Effect.fail(
					new ArtifactError({
						operation: "delete",
						artifact: name,
						reason: `Artifact not found: ${name}`,
					}),
				);
			}
			state.artifacts.delete(name);
			state.uploaded.delete(name);
			return { id: item.id };
		}),
});

/**
 * Test implementation for {@link Artifact}.
 *
 * @example
 * ```ts
 * const state = ArtifactTest.empty();
 * const layer = ArtifactTest.layer(state);
 * ```
 *
 * @public
 */
export const ArtifactTest = {
	/** Create a fresh empty test state container. */
	empty: (): ArtifactTestState => ({
		artifacts: new Map(),
		uploaded: new Map(),
		nextId: 1,
	}),

	/** Create a test layer from the given state. */
	layer: (state: ArtifactTestState): Layer.Layer<Artifact> => Layer.succeed(Artifact, makeTestArtifact(state)),
} as const;
