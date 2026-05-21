import { Effect, Layer, Option } from "effect";
import { Glob } from "../services/Glob.js";

/**
 * In-memory glob state for testing.
 *
 * Maps a patterns string to its matched paths and to a precomputed hash, so a
 * test can pre-seed results without touching disk.
 *
 * @public
 */
export interface GlobTestState {
	readonly matches: Map<string, ReadonlyArray<string>>;
	readonly hashes: Map<string, string>;
}

const makeTestGlob = (state: GlobTestState): typeof Glob.Service => ({
	glob: (patterns) => Effect.succeed(state.matches.get(patterns) ?? []),

	hashFiles: (patterns) => Effect.succeed(Option.fromNullable(state.hashes.get(patterns))),
});

/**
 * Test implementation for {@link Glob}.
 *
 * @example
 * ```ts
 * const state = GlobTest.empty();
 * state.matches.set("*.ts", ["/repo/a.ts", "/repo/b.ts"]);
 * const layer = GlobTest.layer(state);
 * ```
 *
 * @public
 */
export const GlobTest = {
	/**
	 * Create a fresh empty test state container.
	 */
	empty: (): GlobTestState => ({
		matches: new Map(),
		hashes: new Map(),
	}),

	/**
	 * Create a test layer from the given state.
	 */
	layer: (state: GlobTestState): Layer.Layer<Glob> => Layer.succeed(Glob, makeTestGlob(state)),
} as const;
