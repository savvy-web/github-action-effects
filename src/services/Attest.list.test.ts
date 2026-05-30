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

/** Build the Sigstore bundle that `bundle_url` returns under API version 2026-03-10. */
const bundleFor = (predicateType: string) => ({
	mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
	verificationMaterial: {},
	dsseEnvelope: {
		payload: dssePayload({
			_type: "https://in-toto.io/Statement/v1",
			subject: [{ name: "pkg:npm/x@1.0.0", digest: { sha256: "a".repeat(64) } }],
			predicateType,
			predicate: {},
		}),
		payloadType: "application/vnd.in-toto+json",
		signatures: [],
	},
});

interface CapturedRequest {
	readonly route: string;
	readonly params: Record<string, unknown>;
}

/**
 * Faithful simulation of the `2026-03-10` attestations API: the list
 * route honours the server-side `predicate_type` filter and returns
 * entries WITHOUT the inline `bundle` (only `bundle_url`); fetching a
 * `bundle_url` returns the full Sigstore bundle. Optionally records every
 * request for assertions on the pinned API version and query parameters.
 */
const attestationServer = (
	all: ReadonlyArray<{ readonly id: number; readonly predicateType: string }>,
	opts: { readonly repo?: { owner: string; repo: string }; readonly calls?: CapturedRequest[] } = {},
): Layer.Layer<GitHubClient> => {
	const repo = opts.repo ?? { owner: "savvy-web", repo: "silk-release-action" };
	const byUrl = new Map<string, { readonly id: number; readonly predicateType: string }>(
		all.map((a) => [`https://example.test/bundles/${a.id}`, a]),
	);
	const handle = (route: string, params: Record<string, unknown>): unknown => {
		opts.calls?.push({ route, params });
		if (route.includes("{subject_digest}")) {
			const filter = params.predicate_type as string | undefined;
			const selected = filter === undefined ? all : all.filter((a) => a.predicateType === filter);
			return {
				attestations: selected.map((a) => ({
					id: a.id,
					repository_id: 1234,
					bundle_url: `https://example.test/bundles/${a.id}`,
					initiator: "test",
				})),
			};
		}
		const found = byUrl.get(params.bundle_url as string);
		if (found === undefined) {
			const error = new Error("HTTP 404") as Error & { status: number };
			error.status = 404;
			throw error;
		}
		return bundleFor(found.predicateType);
	};
	return Layer.succeed(GitHubClient, {
		rest: <T>(_op: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
			Effect.tryPromise({
				try: () =>
					fn({
						request: (route: string, params: Record<string, unknown>) =>
							Promise.resolve({ data: handle(route, params) }),
					}),
				catch: (e) => e as never,
			}).pipe(Effect.map((r) => r.data)),
		graphql: () => Effect.die("graphql not used"),
		paginate: () => Effect.die("paginate not used"),
		paginateStream: () => Stream.die("paginateStream not used"),
		repo: Effect.succeed(repo),
	});
};

/** Build a synthetic GitHubClient that returns a fixed REST response and ignores graphql/paginate. */
const fixedGitHubClient = (
	restData: unknown,
	repo = { owner: "savvy-web", repo: "silk-release-action" },
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
		repo: Effect.succeed({ owner: "savvy-web", repo: "silk-release-action" }),
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

	it("returns every attestation when no predicateType filter is provided (decoding each bundle_url)", async () => {
		const layer = Layer.mergeAll(
			AttestLive,
			noopSigner,
			noopOidc,
			attestationServer(
				[
					{ id: 1, predicateType: SLSA_PROVENANCE_V1 },
					{ id: 2, predicateType: CYCLONEDX_BOM },
				],
				{ repo: { owner: "acme", repo: "widgets" } },
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

	it("filters by predicateType via the server-side predicate_type query", async () => {
		const layer = Layer.mergeAll(
			AttestLive,
			noopSigner,
			noopOidc,
			attestationServer([
				{ id: 1, predicateType: SLSA_PROVENANCE_V1 },
				{ id: 2, predicateType: CYCLONEDX_BOM },
				{ id: 3, predicateType: SLSA_PROVENANCE_V1 },
			]),
		);

		const entries = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.listForSubject(SUBJECT, { predicateType: SLSA_PROVENANCE_V1 });
			}).pipe(Effect.provide(layer)),
		);

		expect(entries).toHaveLength(2);
		expect(entries.every((e) => e.predicateType === SLSA_PROVENANCE_V1)).toBe(true);
		expect(entries.map((e) => e.attestationUrl)).toEqual([
			"https://github.com/savvy-web/silk-release-action/attestations/1",
			"https://github.com/savvy-web/silk-release-action/attestations/3",
		]);
	});

	it("pins X-GitHub-Api-Version 2026-03-10 and forwards predicate_type without fetching bundles", async () => {
		const calls: CapturedRequest[] = [];
		const layer = Layer.mergeAll(
			AttestLive,
			noopSigner,
			noopOidc,
			attestationServer([{ id: 1, predicateType: SLSA_PROVENANCE_V1 }], { calls }),
		);

		await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.listForSubject(SUBJECT, { predicateType: SLSA_PROVENANCE_V1 });
			}).pipe(Effect.provide(layer)),
		);

		// Only the list request fires — the server-side filter means no
		// per-entry bundle_url fetch on the filtered path.
		expect(calls).toHaveLength(1);
		const list = calls[0];
		expect(list?.route).toBe("GET /repos/{owner}/{repo}/attestations/{subject_digest}");
		expect(list?.params.subject_digest).toBe(`sha256:${SUBJECT}`);
		expect(list?.params.predicate_type).toBe(SLSA_PROVENANCE_V1);
		expect((list?.params.headers as Record<string, string>)["X-GitHub-Api-Version"]).toBe("2026-03-10");
	});

	it("pins X-GitHub-Api-Version 2026-03-10 on both the list and the bundle_url fetch", async () => {
		const calls: CapturedRequest[] = [];
		const layer = Layer.mergeAll(
			AttestLive,
			noopSigner,
			noopOidc,
			attestationServer([{ id: 1, predicateType: SLSA_PROVENANCE_V1 }], { calls }),
		);

		await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.listForSubject(SUBJECT);
			}).pipe(Effect.provide(layer)),
		);

		// List + one bundle fetch, both pinned and the list unfiltered.
		expect(calls).toHaveLength(2);
		expect(calls[0]?.params.predicate_type).toBeUndefined();
		expect(calls[1]?.route).toBe("GET {bundle_url}");
		for (const call of calls) {
			expect((call.params.headers as Record<string, string>)["X-GitHub-Api-Version"]).toBe("2026-03-10");
		}
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
