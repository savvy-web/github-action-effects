/**
 * Tests for `Attest.sbom` — the explicit-BOM path added so consumers
 * can attest a pre-built CycloneDX document (with full NTIA / supplier
 * metadata) rather than re-deriving an empty-deps BOM from scratch.
 *
 * @remarks
 * Covers both branches:
 *
 *  - {@link SbomAttestationInput.bomDocument} present → live impl uses
 *    the supplied document as the in-toto predicate verbatim;
 *  - {@link SbomAttestationInput.dependencies} present → live impl
 *    delegates to the {@link Sbom} service and the dependency list
 *    flows through into the attested BOM;
 *  - neither field → live impl falls back to an empty-deps BOM and
 *    emits a debug log; tests assert on the predicate shape only,
 *    not on log output (Effect's default logger drops debug-level
 *    messages in the test runtime).
 */

import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import {
	Attest,
	AttestLive,
	AttestTest,
	CYCLONEDX_BOM,
	GitHubClient,
	GitHubClientTest,
	OidcTokenIssuer,
	Sbom,
	SbomTest,
	SigstoreSigner,
	makeAttestTestState,
	makeSbomTestState,
} from "../testing.js";

// ─── Common scaffolding ────────────────────────────────────────────

const stubSigner: Layer.Layer<SigstoreSigner> = Layer.succeed(SigstoreSigner, {
	signStatement: () =>
		Effect.succeed({
			mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
			verificationMaterial: { tlogEntries: [] },
			dsseEnvelope: {
				payload: "",
				payloadType: "application/vnd.in-toto+json",
				signatures: [{ sig: "stub", keyid: "" }],
			},
		} as never),
});

const noopOidc: Layer.Layer<OidcTokenIssuer> = Layer.succeed(OidcTokenIssuer, {
	getToken: () => Effect.die("OidcTokenIssuer not reached when SigstoreSigner is stubbed"),
});

const SUBJECT = "feedface".padEnd(64, "0");

// ─── AttestLive.sbom — bomDocument path ────────────────────────────

describe("AttestLive.sbom — explicit BOM document", () => {
	it("does NOT call Sbom.generate when bomDocument is supplied", async () => {
		// Arrange: seed a SbomTest state whose generate would record a
		// call. The test passes only if the live sbom impl skips that
		// branch entirely.
		const sbomState = makeSbomTestState();
		const layer = Layer.mergeAll(
			AttestLive,
			stubSigner,
			noopOidc,
			GitHubClientTest.layer({
				restResponses: new Map([["repos.createAttestation", { data: 7 }]]),
				graphqlResponses: new Map(),
				paginateResponses: new Map(),
				repo: { owner: "acme", repo: "widgets" },
			}),
			SbomTest.layer(sbomState),
		);

		const bomDocument = {
			bomFormat: "CycloneDX" as const,
			specVersion: "1.5" as const,
			version: 1 as const,
			metadata: { component: { name: "@savvy-web/example", version: "1.0.0" } },
			components: [{ type: "library", name: "lodash", version: "4.17.21" }],
		};

		// Act
		const record = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.sbom({
					rootName: "@savvy-web/example",
					rootVersion: "1.0.0",
					subjectSha256: SUBJECT,
					bomDocument,
				});
			}).pipe(Effect.provide(layer)),
		);

		// Assert — Sbom.generate was not invoked; the supplied document
		// flowed through as the in-toto predicate verbatim.
		expect(sbomState.generateCalls).toHaveLength(0);
		expect(record.statement.predicateType).toBe(CYCLONEDX_BOM);
		expect(record.statement.predicate).toEqual(bomDocument);
	});

	it("calls Sbom.generate on the dependency-list path", async () => {
		const sbomState = makeSbomTestState();
		const layer = Layer.mergeAll(
			AttestLive,
			stubSigner,
			noopOidc,
			GitHubClientTest.layer({
				restResponses: new Map([["repos.createAttestation", { data: 11 }]]),
				graphqlResponses: new Map(),
				paginateResponses: new Map(),
				repo: { owner: "acme", repo: "widgets" },
			}),
			SbomTest.layer(sbomState),
		);

		await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.sbom({
					rootName: "@savvy-web/example",
					rootVersion: "1.0.0",
					subjectSha256: SUBJECT,
					dependencies: [{ name: "lodash", version: "4.17.21" }],
				});
			}).pipe(Effect.provide(layer)),
		);

		// Assert — Sbom.generate fired with the supplied dependency
		// list; the bomDocument path was NOT taken.
		expect(sbomState.generateCalls).toHaveLength(1);
		expect(sbomState.generateCalls[0]?.dependencies).toEqual([{ name: "lodash", version: "4.17.21" }]);
	});

	it("falls back to empty-deps when neither field is supplied", async () => {
		const sbomState = makeSbomTestState();
		const layer = Layer.mergeAll(
			AttestLive,
			stubSigner,
			noopOidc,
			GitHubClientTest.layer({
				restResponses: new Map([["repos.createAttestation", { data: 13 }]]),
				graphqlResponses: new Map(),
				paginateResponses: new Map(),
				repo: { owner: "acme", repo: "widgets" },
			}),
			SbomTest.layer(sbomState),
		);

		await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.sbom({
					rootName: "@savvy-web/example",
					rootVersion: "1.0.0",
					subjectSha256: SUBJECT,
				});
			}).pipe(Effect.provide(layer)),
		);

		// Assert — Sbom.generate was invoked with empty deps (no
		// bomDocument, no dependencies → fallback path).
		expect(sbomState.generateCalls).toHaveLength(1);
		expect(sbomState.generateCalls[0]?.dependencies).toEqual([]);
	});
});

// ─── AttestTest.sbom — bomDocument capture ─────────────────────────

describe("AttestTest.sbom — captured calls expose bomDocument", () => {
	it("records the bomDocument on the captured call", async () => {
		const state = makeAttestTestState();
		const bomDocument = {
			bomFormat: "CycloneDX" as const,
			specVersion: "1.5" as const,
			components: [{ type: "library", name: "abc", version: "1.0.0" }],
		};

		await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.sbom({
					rootName: "root",
					rootVersion: "1.0.0",
					subjectSha256: SUBJECT,
					bomDocument,
				});
			}).pipe(
				Effect.provide(
					Layer.mergeAll(AttestTest.layer(state), SbomTest.empty(), GitHubClientTest.empty(), stubSigner, noopOidc),
				),
			),
		);

		expect(state.sbomCalls).toHaveLength(1);
		expect(state.sbomCalls[0]?.bomDocument).toEqual(bomDocument);
	});
});

// Avoid an unused-import lint complaint when the type-only `GitHubClient`
// reference is dropped by tree-shaking — Effect's testing helpers re-export
// from a different module so the tag itself isn't used by name here.
void GitHubClient;
void Sbom;
