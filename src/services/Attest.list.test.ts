/**
 * Tests for `Attest.listForSubject` — the "already attested?" probe
 * used by the publish orchestrator to keep recovery runs idempotent.
 *
 * @remarks
 * Exercises both layers:
 *
 *  - the live implementation against a {@link GitHubClient} test layer
 *    that returns synthetic `GET /repos/.../attestations/{digest}` bodies;
 *  - the {@link AttestTest} layer's seed/capture state.
 *
 * The 404 path is verified directly through the GitHubClient test
 * layer's missing-response behaviour (which raises a 404-shaped
 * GitHubClientError) plus a hand-rolled layer that throws a 404
 * synchronously so we cover both code paths.
 */

import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
	Attest,
	AttestLive,
	AttestTest,
	CYCLONEDX_BOM,
	GitHubClient,
	GitHubClientTest,
	OidcTokenIssuer,
	SLSA_PROVENANCE_V1,
	SigstoreSigner,
	makeAttestTestState,
} from "../testing.js";

// ─── Fixtures ──────────────────────────────────────────────────────

/** Encode an in-toto statement as the DSSE payload field would. */
const dssePayload = (statement: Record<string, unknown>): string =>
	Buffer.from(JSON.stringify(statement), "utf-8").toString("base64");

/**
 * Build a synthetic attestations-list response shaped like
 * `GET /repos/{owner}/{repo}/attestations/{digest}` returns.
 */
const listResponse = (
	entries: ReadonlyArray<{ readonly id: number; readonly predicateType: string; readonly subjectName?: string }>,
) => ({
	attestations: entries.map((e) => ({
		id: e.id,
		bundle: {
			mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
			verificationMaterial: {},
			dsseEnvelope: {
				payload: dssePayload({
					_type: "https://in-toto.io/Statement/v1",
					subject: [{ name: e.subjectName ?? "pkg:npm/x@1.0.0", digest: { sha256: "a".repeat(64) } }],
					predicateType: e.predicateType,
					predicate: {},
				}),
				payloadType: "application/vnd.in-toto+json",
				signatures: [],
			},
		},
		repository_id: 1234,
		bundle_url: `https://example.test/bundles/${e.id}`,
		initiator: "test",
	})),
});

/** Build a synthetic GitHubClient that returns a fixed REST response and ignores graphql/paginate. */
const fixedGitHubClient = (
	restData: unknown,
	repo = { owner: "savvy-web", repo: "workflow-release-action" },
): Layer.Layer<GitHubClient> =>
	Layer.succeed(GitHubClient, {
		rest: <T>(_op: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
			Effect.tryPromise({
				try: () =>
					fn({
						request: (_route: string, _params: Record<string, unknown>) => Promise.resolve({ data: restData }),
					}),
				catch: (e) => e as never,
			}).pipe(Effect.map((r) => r.data)),
		graphql: () => Effect.die("graphql not used"),
		paginate: () => Effect.die("paginate not used"),
		paginateStream: () => Stream.die("paginateStream not used"),
		repo: Effect.succeed(repo),
	});

/** GitHubClient that throws a 404-shaped error from the request callback. */
const throwingGitHubClient = (status: number): Layer.Layer<GitHubClient> =>
	Layer.succeed(GitHubClient, {
		rest: <T>(_op: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
			Effect.tryPromise({
				try: () =>
					fn({
						request: (_route: string, _params: Record<string, unknown>) => {
							const error = new Error(`HTTP ${status}`) as Error & { status: number };
							error.status = status;
							return Promise.reject(error);
						},
					}),
				catch: (e) => e as never,
			}).pipe(Effect.map((r) => r.data)),
		graphql: () => Effect.die("graphql not used"),
		paginate: () => Effect.die("paginate not used"),
		paginateStream: () => Stream.die("paginateStream not used"),
		repo: Effect.succeed({ owner: "savvy-web", repo: "workflow-release-action" }),
	});

const noopOidc: Layer.Layer<OidcTokenIssuer> = Layer.succeed(OidcTokenIssuer, {
	getToken: () => Effect.die("OidcTokenIssuer not used in list tests"),
});

const noopSigner: Layer.Layer<SigstoreSigner> = Layer.succeed(SigstoreSigner, {
	signStatement: () => Effect.die("SigstoreSigner not used in list tests"),
});

// ─── AttestLive.listForSubject ─────────────────────────────────────

describe("Attest.listForSubject — live implementation", () => {
	const SUBJECT = "abc123".padEnd(64, "0");

	it("returns every attestation when no predicateType filter is provided", async () => {
		const layer = Layer.mergeAll(
			AttestLive,
			noopSigner,
			noopOidc,
			fixedGitHubClient(
				listResponse([
					{ id: 1, predicateType: SLSA_PROVENANCE_V1 },
					{ id: 2, predicateType: CYCLONEDX_BOM },
				]),
				{ owner: "acme", repo: "widgets" },
			),
		);

		const entries = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.listForSubject(SUBJECT);
			}).pipe(Effect.provide(layer)),
		);

		expect(entries).toHaveLength(2);
		expect(entries[0]?.attestationUrl).toBe("https://github.com/acme/widgets/attestations/1");
		expect(entries[0]?.predicateType).toBe(SLSA_PROVENANCE_V1);
		expect(entries[1]?.attestationUrl).toBe("https://github.com/acme/widgets/attestations/2");
		expect(entries[1]?.predicateType).toBe(CYCLONEDX_BOM);
	});

	it("filters by predicateType client-side", async () => {
		const layer = Layer.mergeAll(
			AttestLive,
			noopSigner,
			noopOidc,
			fixedGitHubClient(
				listResponse([
					{ id: 1, predicateType: SLSA_PROVENANCE_V1 },
					{ id: 2, predicateType: CYCLONEDX_BOM },
					{ id: 3, predicateType: SLSA_PROVENANCE_V1 },
				]),
			),
		);

		const entries = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.listForSubject(SUBJECT, { predicateType: SLSA_PROVENANCE_V1 });
			}).pipe(Effect.provide(layer)),
		);

		expect(entries).toHaveLength(2);
		expect(entries.every((e) => e.predicateType === SLSA_PROVENANCE_V1)).toBe(true);
	});

	it("returns [] when the API responds with an empty attestations array", async () => {
		const layer = Layer.mergeAll(AttestLive, noopSigner, noopOidc, fixedGitHubClient({ attestations: [] }));

		const entries = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.listForSubject(SUBJECT);
			}).pipe(Effect.provide(layer)),
		);

		expect(entries).toEqual([]);
	});

	it("returns [] on a 404 (subject has no attestations at all)", async () => {
		const layer = Layer.mergeAll(AttestLive, noopSigner, noopOidc, throwingGitHubClient(404));

		const entries = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.listForSubject(SUBJECT);
			}).pipe(Effect.provide(layer)),
		);

		expect(entries).toEqual([]);
	});
});

// ─── AttestTest.listForSubject ─────────────────────────────────────

describe("Attest.listForSubject — test layer", () => {
	const SUBJECT = "deadbeef".padEnd(64, "0");

	it("returns the seeded entries for a subject", async () => {
		const state = makeAttestTestState();
		state.seedAttestations.set(SUBJECT, [
			{ attestationUrl: "https://github.com/acme/repo/attestations/1", predicateType: SLSA_PROVENANCE_V1 },
			{ attestationUrl: "https://github.com/acme/repo/attestations/2", predicateType: CYCLONEDX_BOM },
		]);

		const entries = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.listForSubject(SUBJECT);
			}).pipe(Effect.provide(Layer.merge(AttestTest.layer(state), GitHubClientTest.empty()))),
		);

		expect(entries).toHaveLength(2);
		expect(state.listForSubjectCalls).toEqual([{ subjectSha256: SUBJECT, predicateType: undefined }]);
	});

	it("filters seeded entries by predicateType when requested", async () => {
		const state = makeAttestTestState();
		state.seedAttestations.set(SUBJECT, [
			{ attestationUrl: "u1", predicateType: SLSA_PROVENANCE_V1 },
			{ attestationUrl: "u2", predicateType: CYCLONEDX_BOM },
		]);

		const entries = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.listForSubject(SUBJECT, { predicateType: CYCLONEDX_BOM });
			}).pipe(Effect.provide(Layer.merge(AttestTest.layer(state), GitHubClientTest.empty()))),
		);

		expect(entries).toEqual([{ attestationUrl: "u2", predicateType: CYCLONEDX_BOM }]);
		expect(state.listForSubjectCalls).toEqual([{ subjectSha256: SUBJECT, predicateType: CYCLONEDX_BOM }]);
	});

	it("returns [] for an unseeded subject", async () => {
		const state = makeAttestTestState();

		const entries = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.listForSubject(SUBJECT);
			}).pipe(Effect.provide(Layer.merge(AttestTest.layer(state), GitHubClientTest.empty()))),
		);

		expect(entries).toEqual([]);
		expect(state.listForSubjectCalls).toHaveLength(1);
	});
});
