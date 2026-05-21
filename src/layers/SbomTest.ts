import { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";
import type { CycloneDXBom, SbomInput } from "../services/Sbom.js";
import { Sbom } from "../services/Sbom.js";

// ─── SbomTest ────────────────────────────────────────────────────────

/**
 * Mutable state recorded by {@link SbomTest.layer}.
 *
 * @public
 */
export interface SbomTestState {
	/** Inputs passed to every {@link Sbom.generate} call. */
	readonly generateCalls: SbomInput[];
	/** Path → BOM captured by {@link Sbom.save}. */
	readonly saves: Map<string, CycloneDXBom>;
	/** Override the BOM returned from {@link Sbom.generate}. */
	readonly bomResponse?: CycloneDXBom;
	/** Override the JSON returned from {@link Sbom.serializeJson}. */
	readonly jsonResponse?: string;
}

/**
 * Synthetic Bom-shaped stub for the test layer.
 *
 * @remarks
 * Avoids importing `@cyclonedx/cyclonedx-library` at module-init time —
 * the library's static-import chain pulls in optional plugins that
 * fail to resolve in the bundled action when `Sbom.generate` is never
 * called. Tests that need a real Bom should provide one via
 * `state.bomResponse`.
 */
const minimalBom = (): CycloneDXBom => ({}) as unknown as CycloneDXBom;

/**
 * Build a fresh, empty {@link SbomTestState}.
 *
 * @public
 */
export const makeSbomTestState = (overrides: Partial<SbomTestState> = {}): SbomTestState => ({
	generateCalls: [],
	saves: new Map(),
	...overrides,
});

const defaultJson = (): string =>
	JSON.stringify(
		{
			bomFormat: "CycloneDX",
			specVersion: "1.5",
			version: 1,
			metadata: { component: { type: "library", name: "test-root", version: "0.0.0" } },
			components: [],
		},
		null,
		2,
	);

/**
 * Test layer factories for {@link Sbom}.
 *
 * @public
 */
export const SbomTest = {
	layer: (state: SbomTestState): Layer.Layer<Sbom> =>
		Layer.succeed(Sbom, {
			generate: (input) =>
				Effect.sync(() => {
					state.generateCalls.push(input);
					return state.bomResponse ?? minimalBom();
				}),

			serializeJson: () => Effect.sync(() => state.jsonResponse ?? defaultJson()),

			save: (bom, path) =>
				Effect.gen(function* () {
					state.saves.set(path, bom);
					yield* FileSystem.FileSystem;
				}),
		}),

	empty: (): Layer.Layer<Sbom> => SbomTest.layer(makeSbomTestState()),
};
