import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ChangesetAnalyzerTest } from "../layers/ChangesetAnalyzerTest.js";
import type { Changeset } from "../schemas/Changeset.js";
import { ChangesetAnalyzer } from "./ChangesetAnalyzer.js";

const provide = <A, E>(
	state: ReturnType<typeof ChangesetAnalyzerTest.empty>,
	effect: Effect.Effect<A, E, ChangesetAnalyzer>,
) => Effect.provide(effect, ChangesetAnalyzerTest.layer(state));

const run = <A, E>(
	state: ReturnType<typeof ChangesetAnalyzerTest.empty>,
	effect: Effect.Effect<A, E, ChangesetAnalyzer>,
) => Effect.runPromise(provide(state, effect));

const sampleChangeset: Changeset = {
	id: "brave-cloud-42",
	packages: [{ name: "@scope/pkg-a", bump: "minor" }],
	summary: "Add new feature",
};

describe("ChangesetAnalyzer", () => {
	describe("parseAll", () => {
		it("returns changesets from state", async () => {
			const state = ChangesetAnalyzerTest.empty();
			state.changesets.push(sampleChangeset);

			const result = await run(
				state,
				Effect.flatMap(ChangesetAnalyzer, (svc) => svc.parseAll()),
			);
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				id: "brave-cloud-42",
				packages: [{ name: "@scope/pkg-a", bump: "minor" }],
				summary: "Add new feature",
			});
		});
	});

	describe("hasChangesets", () => {
		it("returns true when changesets exist", async () => {
			const state = ChangesetAnalyzerTest.empty();
			state.changesets.push(sampleChangeset);

			const result = await run(
				state,
				Effect.flatMap(ChangesetAnalyzer, (svc) => svc.hasChangesets()),
			);
			expect(result).toBe(true);
		});

		it("returns false when empty", async () => {
			const state = ChangesetAnalyzerTest.empty();
			const result = await run(
				state,
				Effect.flatMap(ChangesetAnalyzer, (svc) => svc.hasChangesets()),
			);
			expect(result).toBe(false);
		});
	});

	describe("generate", () => {
		it("creates file with correct format", async () => {
			const state = ChangesetAnalyzerTest.empty();
			const result = await run(
				state,
				Effect.flatMap(ChangesetAnalyzer, (svc) =>
					svc.generate([{ name: "@scope/pkg-a", bump: "minor" }], "Add new feature"),
				),
			);

			expect(result.content).toContain('"@scope/pkg-a": minor');
			expect(result.content).toContain("Add new feature");
			expect(result.path).toMatch(/\.changeset\/.+\.md$/);
		});

		it("records to state", async () => {
			const state = ChangesetAnalyzerTest.empty();
			await run(
				state,
				Effect.flatMap(ChangesetAnalyzer, (svc) => svc.generate([{ name: "@scope/pkg-b", bump: "patch" }], "Fix bug")),
			);

			expect(state.generated).toHaveLength(1);
			expect(state.generated[0].content).toContain('"@scope/pkg-b": patch');
		});
	});
});
