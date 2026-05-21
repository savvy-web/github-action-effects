/**
 * Step-4 tests for the Attest service: end-to-end attestation upload.
 *
 * @remarks
 * Drives `AttestLive.attest` against a stub `SigstoreSigner` and the
 * upstream `GitHubClientTest` layer so the full
 * statement → sign → upload chain is exercised without touching the
 * network. The Live Sigstore + GitHub path is exercised in the
 * silk-integration repo run, not here.
 */

import { Cause, Effect, Exit, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { InTotoStatement } from "../testing.js";
import {
	Attest,
	AttestLive,
	GitHubClient,
	GitHubClientError,
	GitHubClientTest,
	OidcTokenIssuer,
	SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE,
	SLSA_PROVENANCE_V1,
	SigstoreBundle,
	SigstoreSigner,
	npmPurl,
	subject,
} from "../testing.js";

const stubBundle = (subjectName: string): SigstoreBundle =>
	new SigstoreBundle({
		mediaType: SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE,
		verificationMaterial: { tlogEntries: [], subjectName },
		dsseEnvelope: {
			payload: "base64-payload",
			payloadType: "application/vnd.in-toto+json",
			signatures: [{ sig: "stub-sig", keyid: "" }],
		},
	});

const stubSignerLayer: Layer.Layer<SigstoreSigner> = Layer.succeed(SigstoreSigner, {
	signStatement: (statement: InTotoStatement) => Effect.succeed(stubBundle(statement.subject[0].name)),
});

const noopOidcLayer: Layer.Layer<OidcTokenIssuer> = Layer.succeed(OidcTokenIssuer, {
	getToken: () => Effect.die("OidcTokenIssuer should not be reached when SigstoreSigner is stubbed"),
});

const makeGitHubClientLayer = (
	restResponse: { data: unknown } | undefined,
	repo = { owner: "savvy-web", repo: "workflow-release-action" },
): Layer.Layer<GitHubClient> =>
	GitHubClientTest.layer({
		restResponses: restResponse ? new Map([["repos.createAttestation", restResponse]]) : new Map(),
		graphqlResponses: new Map(),
		paginateResponses: new Map(),
		repo,
	});

describe("Attest.attest — step 4: end-to-end upload", () => {
	it("builds, signs, and POSTs the attestation, returning the full record", async () => {
		const layer = Layer.mergeAll(
			AttestLive,
			stubSignerLayer,
			noopOidcLayer,
			makeGitHubClientLayer({ data: 42 }, { owner: "savvy-web", repo: "silk-integration" }),
		);

		const record = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.attest({
					subjects: [subject(npmPurl("@savvy-web/example", "1.0.0"), "a".repeat(64))],
					predicateType: SLSA_PROVENANCE_V1,
					predicate: { buildType: "https://example.com/build" },
				});
			}).pipe(Effect.provide(layer)),
		);

		expect(record.attestationId).toBe(42);
		expect(record.attestationUrl).toBe("https://github.com/savvy-web/silk-integration/attestations/42");
		expect(record.statement.subject[0].name).toBe("pkg:npm/@savvy-web/example@1.0.0");
		expect(record.bundle.mediaType).toBe(SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE);
		const material = record.bundle.verificationMaterial as { subjectName: string };
		expect(material.subjectName).toBe("pkg:npm/@savvy-web/example@1.0.0");
	});

	it("maps GitHubClient failures to AttestError(reason: upload)", async () => {
		const failingClientLayer: Layer.Layer<GitHubClient> = Layer.succeed(GitHubClient, {
			rest: () =>
				Effect.fail(
					new GitHubClientError({
						operation: "repos.createAttestation",
						status: 403,
						reason: "permission denied: missing attestations:write",
						retryable: false,
						retryAfterMs: undefined,
					}),
				),
			graphql: () => Effect.die("graphql should not be called"),
			paginate: () => Effect.die("paginate should not be called"),
			paginateStream: () => Stream.die("paginateStream should not be called"),
			repo: Effect.succeed({ owner: "savvy-web", repo: "silk-integration" }),
		});

		const layer = Layer.mergeAll(AttestLive, stubSignerLayer, noopOidcLayer, failingClientLayer);

		const exit = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.attest({
					subjects: [subject("pkg:npm/x@1.0.0", "b".repeat(64))],
					predicateType: SLSA_PROVENANCE_V1,
					predicate: {},
				});
			}).pipe(Effect.provide(layer), Effect.exit),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const failure = Cause.failureOption(exit.cause);
			expect(failure._tag).toBe("Some");
			if (failure._tag === "Some") {
				expect(failure.value._tag).toBe("AttestError");
				expect(failure.value.reason).toBe("upload");
				expect(failure.value.message).toContain("permission denied");
			}
		}
	});

	it("uses the GitHubClient repo context for the attestation URL", async () => {
		const layer = Layer.mergeAll(
			AttestLive,
			stubSignerLayer,
			noopOidcLayer,
			makeGitHubClientLayer({ data: 99 }, { owner: "acme", repo: "widgets" }),
		);

		const record = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.attest({
					subjects: [subject("pkg:npm/x@1.0.0", "c".repeat(64))],
					predicateType: SLSA_PROVENANCE_V1,
					predicate: {},
				});
			}).pipe(Effect.provide(layer)),
		);

		expect(record.attestationId).toBe(99);
		expect(record.attestationUrl).toBe("https://github.com/acme/widgets/attestations/99");
	});
});
