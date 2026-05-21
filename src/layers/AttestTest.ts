import { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";
import type { AttestError } from "../errors/AttestError.js";
import type { AttestInput, AttestationRecord, InTotoStatement } from "../schemas/Attestation.js";
import { SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE, SigstoreBundle } from "../schemas/Attestation.js";
import type { AttestationListEntry, ProvenanceAttestationInput, SbomAttestationInput } from "../services/Attest.js";
import { Attest } from "../services/Attest.js";
import { buildStatement, subject as makeSubject } from "../utils/intoto.js";
import { GitHubClientTest } from "./GitHubClientTest.js";
import { OidcTokenIssuerTest } from "./OidcTokenIssuerTest.js";
import { SbomTest } from "./SbomTest.js";
import { SigstoreSignerTest } from "./SigstoreSignerTest.js";

// ─── AttestTest ──────────────────────────────────────────────────────

/**
 * Mutable state recorded by {@link AttestTest.layer}.
 *
 * @public
 */
export interface AttestTestState {
	/** Inputs passed to every {@link Attest.buildStatement} call. */
	readonly buildStatementCalls: AttestInput[];
	/** Inputs passed to every {@link Attest.buildBundle} call. */
	readonly buildBundleCalls: AttestInput[];
	/** Inputs passed to every {@link Attest.attest} call. */
	readonly attestCalls: AttestInput[];
	/** Inputs passed to every {@link Attest.sbom} call. */
	readonly sbomCalls: SbomAttestationInput[];
	/** Inputs passed to every {@link Attest.provenance} call. */
	readonly provenanceCalls: ProvenanceAttestationInput[];
	/** Inputs passed to every {@link Attest.listForSubject} call. */
	readonly listForSubjectCalls: Array<{
		readonly subjectSha256: string;
		readonly predicateType: string | undefined;
	}>;
	/** Path → data captured by {@link Attest.save}. */
	readonly saves: Map<string, InTotoStatement | SigstoreBundle>;
	/**
	 * Pre-seeded attestation entries indexed by tarball sha256-hex. The
	 * {@link Attest.listForSubject} test implementation returns the
	 * matching entry list (filtered by `predicateType` when requested);
	 * an unseeded subject returns the empty array.
	 */
	readonly seedAttestations: Map<string, ReadonlyArray<AttestationListEntry>>;
	/**
	 * Override the synthetic attestation id used in returned records.
	 * Defaults to `1`.
	 */
	readonly attestationId?: number;
	/**
	 * Override the synthetic GitHub repo path baked into the
	 * attestation URL. Defaults to `"test-owner/test-repo"`.
	 */
	readonly repo?: string;
	/**
	 * If set, every Attest operation that would normally succeed fails
	 * with this error instead. Useful for testing error-handling paths.
	 */
	readonly failWith?: AttestError;
}

/**
 * Build a fresh, empty {@link AttestTestState}.
 *
 * @public
 */
export const makeAttestTestState = (overrides: Partial<AttestTestState> = {}): AttestTestState => ({
	buildStatementCalls: [],
	buildBundleCalls: [],
	attestCalls: [],
	sbomCalls: [],
	provenanceCalls: [],
	listForSubjectCalls: [],
	saves: new Map(),
	seedAttestations: new Map(),
	...overrides,
});

const stubBundle = (): SigstoreBundle =>
	new SigstoreBundle({
		mediaType: SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE,
		verificationMaterial: { tlogEntries: [] },
		dsseEnvelope: {
			payload: "",
			payloadType: "application/vnd.in-toto+json",
			signatures: [{ sig: "test-signature", keyid: "" }],
		},
	});

const stubRecord = (state: AttestTestState, statement: InTotoStatement): AttestationRecord => {
	const id = state.attestationId ?? 1;
	const repo = state.repo ?? "test-owner/test-repo";
	return {
		statement,
		bundle: stubBundle(),
		attestationId: id,
		attestationUrl: `https://github.com/${repo}/attestations/${id}`,
	};
};

const failOrSucceed = <A>(state: AttestTestState, value: A): Effect.Effect<A, AttestError> =>
	state.failWith ? Effect.fail(state.failWith) : Effect.succeed(value);

/**
 * Test layer factories for {@link Attest}.
 *
 * @public
 */
export const AttestTest = {
	/**
	 * Test layer that records every call into `state` and returns
	 * synthetic responses. Pass the same `state` object to your test's
	 * assertions to inspect what was called.
	 */
	layer: (state: AttestTestState): Layer.Layer<Attest> =>
		Layer.succeed(Attest, {
			buildStatement: (input) =>
				Effect.sync(() => {
					state.buildStatementCalls.push(input);
					return buildStatement(input);
				}).pipe(Effect.flatMap((s) => failOrSucceed(state, s))),

			save: (data, path) =>
				Effect.gen(function* () {
					if (state.failWith) return yield* Effect.fail(state.failWith);
					state.saves.set(path, data);
					// Touch FileSystem so the resource declaration in the
					// service signature stays honest under the test layer.
					yield* FileSystem.FileSystem;
				}),

			buildBundle: (input) =>
				Effect.sync(() => {
					state.buildBundleCalls.push(input);
					return stubBundle();
				}).pipe(Effect.flatMap((b) => failOrSucceed(state, b))),

			attest: (input) =>
				Effect.sync(() => {
					state.attestCalls.push(input);
					return stubRecord(state, buildStatement(input));
				}).pipe(Effect.flatMap((r) => failOrSucceed(state, r))),

			sbom: (input) =>
				Effect.sync(() => {
					state.sbomCalls.push(input);
					// When the caller passed `bomDocument` (the explicit-BOM
					// path) use it verbatim as the predicate; otherwise fall
					// back to a minimal empty-deps CycloneDX stub. Mirrors the
					// branch the live implementation takes so tests assert on
					// the right shape.
					const predicate: unknown =
						input.bomDocument !== undefined
							? input.bomDocument
							: { bomFormat: "CycloneDX", specVersion: "1.5", components: [] };
					return stubRecord(
						state,
						buildStatement({
							subjects: [makeSubject(`pkg:npm/${input.rootName}@${input.rootVersion}`, input.subjectSha256)],
							predicateType: "https://cyclonedx.org/bom",
							predicate,
						}),
					);
				}).pipe(Effect.flatMap((r) => failOrSucceed(state, r))),

			provenance: (input) =>
				Effect.sync(() => {
					state.provenanceCalls.push(input);
					return stubRecord(
						state,
						buildStatement({
							subjects: [makeSubject(input.subjectName, input.subjectSha256)],
							predicateType: "https://slsa.dev/provenance/v1",
							predicate: input.predicate,
						}),
					);
				}).pipe(Effect.flatMap((r) => failOrSucceed(state, r))),

			listForSubject: (subjectSha256, options) =>
				Effect.sync(() => {
					state.listForSubjectCalls.push({
						subjectSha256,
						predicateType: options?.predicateType,
					});
					const seeded = state.seedAttestations.get(subjectSha256) ?? [];
					return options?.predicateType !== undefined
						? seeded.filter((e) => e.predicateType === options.predicateType)
						: seeded;
				}).pipe(Effect.flatMap((r) => failOrSucceed(state, r))),
		}),

	/**
	 * Test layer with default state — useful when the test doesn't care
	 * what calls were made, only that the service is available.
	 */
	empty: (): Layer.Layer<Attest> => AttestTest.layer(makeAttestTestState()),
};

/**
 * Composed layer that provides `Attest` plus every dependency it
 * declares (`SigstoreSigner`, `OidcTokenIssuer`, `Sbom`, and
 * `GitHubClient`). Use this when you just want to call into `Attest`
 * from a test without wiring four layers by hand.
 *
 * @public
 */
export const AttestTestFullLayer = (state: AttestTestState = makeAttestTestState()) =>
	Layer.mergeAll(
		AttestTest.layer(state),
		SigstoreSignerTest,
		OidcTokenIssuerTest,
		SbomTest.empty(),
		GitHubClientTest.empty(),
	);
