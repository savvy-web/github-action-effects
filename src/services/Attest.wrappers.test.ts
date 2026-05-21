/**
 * Step-6 tests for the Attest service: sbom + provenance wrappers.
 *
 * @remarks
 * Exercises the two convenience methods by stubbing `SigstoreSigner`
 * and capturing the in-toto statement that lands at the signing
 * boundary. The full sign → upload chain is the same code path as
 * `attest()` (covered in attest-end-to-end.test.ts), so these tests
 * focus on the wrapper-specific behavior: subject construction,
 * predicate type selection, and BOM-as-predicate composition.
 */

import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { InTotoStatement } from "../testing.js";
import {
	Attest,
	AttestLive,
	CYCLONEDX_BOM,
	GitHubClientTest,
	OidcTokenIssuer,
	SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE,
	SLSA_PROVENANCE_V1,
	SbomLive,
	SigstoreBundle,
	SigstoreSigner,
} from "../testing.js";

interface SignerCalls {
	statements: InTotoStatement[];
}

const stubBundle = (): SigstoreBundle =>
	new SigstoreBundle({
		mediaType: SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE,
		verificationMaterial: { tlogEntries: [] },
		dsseEnvelope: {
			payload: "base64-payload",
			payloadType: "application/vnd.in-toto+json",
			signatures: [{ sig: "stub-sig", keyid: "" }],
		},
	});

const stubSignerLayer = (calls: SignerCalls): Layer.Layer<SigstoreSigner> =>
	Layer.succeed(SigstoreSigner, {
		signStatement: (statement) =>
			Effect.sync(() => {
				calls.statements.push(statement);
				return stubBundle();
			}),
	});

const noopOidcLayer: Layer.Layer<OidcTokenIssuer> = Layer.succeed(OidcTokenIssuer, {
	getToken: () => Effect.die("OidcTokenIssuer should not be reached when SigstoreSigner is stubbed"),
});

const githubClientLayer = GitHubClientTest.layer({
	restResponses: new Map([["repos.createAttestation", { data: 7 }]]),
	graphqlResponses: new Map(),
	paginateResponses: new Map(),
	repo: { owner: "savvy-web", repo: "silk-integration" },
});

describe("Attest.sbom — step 6", () => {
	it("attaches a CycloneDX BOM as predicate and uses CYCLONEDX_BOM predicateType", async () => {
		const calls: SignerCalls = { statements: [] };
		const layer = Layer.mergeAll(AttestLive, SbomLive, stubSignerLayer(calls), noopOidcLayer, githubClientLayer);

		const record = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.sbom({
					rootName: "@savvy-web/example",
					rootVersion: "1.0.0",
					rootLicense: "MIT",
					subjectSha256: "a".repeat(64),
					dependencies: [
						{ name: "lodash", version: "4.17.21", license: "MIT" },
						{ name: "@savvy-web/package-2", version: "0.9.0" },
					],
					inFlightPackages: [{ name: "@savvy-web/package-2", version: "1.0.0", license: "MIT" }],
				});
			}).pipe(Effect.provide(layer)),
		);

		expect(record.attestationId).toBe(7);
		expect(record.attestationUrl).toBe("https://github.com/savvy-web/silk-integration/attestations/7");

		expect(calls.statements).toHaveLength(1);
		const statement = calls.statements[0];
		expect(statement.predicateType).toBe(CYCLONEDX_BOM);
		expect(statement.subject).toHaveLength(1);
		expect(statement.subject[0].name).toBe("pkg:npm/@savvy-web/example@1.0.0");
		expect(statement.subject[0].digest).toEqual({ sha256: "a".repeat(64) });

		const predicate = statement.predicate as {
			bomFormat: string;
			specVersion: string;
			components: Array<{ name: string; version: string }>;
		};
		expect(predicate.bomFormat).toBe("CycloneDX");
		expect(predicate.specVersion).toBe("1.5");
		const sibling = predicate.components.find((c) => c.name === "@savvy-web/package-2");
		expect(sibling?.version).toBe("1.0.0");
	});
});

describe("Attest.provenance — step 6", () => {
	it("wraps a caller-supplied SLSA predicate with SLSA_PROVENANCE_V1 predicateType", async () => {
		const calls: SignerCalls = { statements: [] };
		const layer = Layer.mergeAll(AttestLive, stubSignerLayer(calls), noopOidcLayer, githubClientLayer);

		const slsaPredicate = {
			buildDefinition: {
				buildType: "https://github.com/savvy-web/workflow-release-action/release/v1",
				externalParameters: { workflow: { ref: "refs/heads/main" } },
			},
			runDetails: {
				builder: { id: "https://github.com/actions/runner" },
				metadata: { invocationId: "abc-123" },
			},
		};

		const record = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.provenance({
					subjectName: "pkg:npm/@savvy-web/example@1.0.0",
					subjectSha256: "b".repeat(64),
					predicate: slsaPredicate,
				});
			}).pipe(Effect.provide(layer)),
		);

		expect(record.attestationId).toBe(7);

		expect(calls.statements).toHaveLength(1);
		const statement = calls.statements[0];
		expect(statement.predicateType).toBe(SLSA_PROVENANCE_V1);
		expect(statement.subject[0].name).toBe("pkg:npm/@savvy-web/example@1.0.0");
		expect(statement.subject[0].digest).toEqual({ sha256: "b".repeat(64) });
		expect(statement.predicate).toEqual(slsaPredicate);
	});

	it("strips a leading sha256: prefix from the digest", async () => {
		const calls: SignerCalls = { statements: [] };
		const layer = Layer.mergeAll(AttestLive, stubSignerLayer(calls), noopOidcLayer, githubClientLayer);

		await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.provenance({
					subjectName: "pkg:npm/x@1.0.0",
					subjectSha256: `sha256:${"c".repeat(64)}`,
					predicate: { buildDefinition: {}, runDetails: {} },
				});
			}).pipe(Effect.provide(layer)),
		);

		expect(calls.statements[0].subject[0].digest).toEqual({ sha256: "c".repeat(64) });
	});
});
