import { Effect, Layer } from "effect";
import type { BumpType, Changeset, ChangesetFile } from "../schemas/Changeset.js";
import { ChangesetAnalyzer } from "../services/ChangesetAnalyzer.js";

/**
 * Test state for ChangesetAnalyzer.
 *
 * @public
 */
export interface ChangesetAnalyzerTestState {
	readonly changesets: Array<Changeset>;
	readonly generated: Array<ChangesetFile>;
}

const makeTestChangesetAnalyzer = (state: ChangesetAnalyzerTestState): typeof ChangesetAnalyzer.Service => ({
	parseAll: (_dir?: string) => Effect.succeed(state.changesets),

	hasChangesets: (_dir?: string) => Effect.succeed(state.changesets.length > 0),

	generate: (packages: Array<{ name: string; bump: BumpType }>, summary: string, _dir?: string) => {
		const frontmatter = packages.map((p) => `"${p.name}": ${p.bump}`).join("\n");
		const content = `---\n${frontmatter}\n---\n\n${summary}\n`;
		const file: ChangesetFile = { path: `.changeset/test-changeset.md`, content };
		state.generated.push(file);
		return Effect.succeed(file);
	},
});

/**
 * Test implementation for ChangesetAnalyzer.
 *
 * @public
 */
export const ChangesetAnalyzerTest = {
	/** Create test layer with pre-configured state. */
	layer: (state: ChangesetAnalyzerTestState): Layer.Layer<ChangesetAnalyzer> =>
		Layer.succeed(ChangesetAnalyzer, makeTestChangesetAnalyzer(state)),

	/** Create a fresh empty test state. */
	empty: (): ChangesetAnalyzerTestState => ({
		changesets: [],
		generated: [],
	}),
} as const;
