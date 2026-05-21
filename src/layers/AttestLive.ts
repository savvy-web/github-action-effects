/**
 * Live implementation of the {@link Attest} service.
 *
 * @remarks
 * Composes the pure in-toto builder ({@link buildStatement}), the
 * {@link SigstoreSigner} (Fulcio + Rekor), and the upstream
 * `GitHubClient` to provide a single `attest()` entry point for signed
 * provenance + SBOM attestations.
 */

import { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";
import { AttestError } from "../errors/AttestError.js";
import type { AttestInput, AttestationRecord, SigstoreBundle } from "../schemas/Attestation.js";
import { CYCLONEDX_BOM, InTotoStatement, SLSA_PROVENANCE_V1 } from "../schemas/Attestation.js";
import type { AttestationListEntry } from "../services/Attest.js";
import { Attest } from "../services/Attest.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { Sbom } from "../services/Sbom.js";
import { SigstoreSigner } from "../services/SigstoreSigner.js";
import { buildStatement, subject as makeSubject, npmPurl, serializeStatement } from "../utils/intoto.js";

const CREATE_ATTESTATION_REQUEST = "POST /repos/{owner}/{repo}/attestations" as const;
const LIST_ATTESTATIONS_REQUEST = "GET /repos/{owner}/{repo}/attestations/{subject_digest}" as const;

interface OctokitLike {
	readonly request: (route: string, params: Record<string, unknown>) => Promise<{ data: unknown }>;
}

const isOctokitLike = (value: unknown): value is OctokitLike =>
	typeof value === "object" &&
	value !== null &&
	"request" in value &&
	typeof (value as OctokitLike).request === "function";

const attestationIdFromResponse = (raw: unknown): number => {
	const data = typeof raw === "string" ? JSON.parse(raw) : raw;
	if (data && typeof data === "object" && "id" in data && typeof (data as { id: unknown }).id === "number") {
		return (data as { id: number }).id;
	}
	throw new Error(
		`GitHub attestations API response did not include a numeric id: ${JSON.stringify(data).slice(0, 200)}`,
	);
};

/**
 * Shape of one `attestations[]` entry on `GET /repos/.../attestations/{subject_digest}`.
 *
 * @remarks
 * Mirrors the Octokit OpenAPI surface: `bundle.dsseEnvelope.payload`
 * is a base64-encoded in-toto statement, `repository_id` /
 * `bundle_url` / `initiator` are advisory metadata. The real GitHub
 * API also includes an `id` field on each entry that the OpenAPI
 * types omit — we read it defensively when present so the result's
 * `attestationUrl` can point at the GitHub UI.
 *
 * @internal
 */
interface RawListedAttestation {
	readonly id?: number;
	readonly bundle?: {
		readonly dsseEnvelope?: {
			readonly payload?: string;
		};
	};
	readonly bundle_url?: string;
}

/**
 * Decode a base64-encoded DSSE payload and extract the in-toto
 * statement's `predicateType`.
 *
 * @remarks
 * The DSSE payload is a base64-encoded JSON in-toto statement; the
 * statement carries `predicateType` as a top-level string. Returns
 * `null` when the payload is missing, undecodable, or non-JSON —
 * callers treat that as "unknown predicate type" and filter the
 * entry out of any predicate-type-filtered result.
 *
 * @internal
 */
const predicateTypeFromBundle = (entry: RawListedAttestation): string | null => {
	const payload = entry.bundle?.dsseEnvelope?.payload;
	if (typeof payload !== "string" || payload.length === 0) return null;
	try {
		const decoded = Buffer.from(payload, "base64").toString("utf-8");
		const statement = JSON.parse(decoded) as { predicateType?: unknown };
		return typeof statement.predicateType === "string" ? statement.predicateType : null;
	} catch {
		return null;
	}
};

/**
 * Parse the raw `GET /repos/.../attestations/{subject_digest}` body
 * into a list of {@link AttestationListEntry} rows.
 *
 * @remarks
 * Owner/repo are needed to construct the GitHub UI URL when the
 * response carries a numeric `id`. When `id` is missing, we fall
 * back to `bundle_url` (the raw-bundle endpoint) so callers always
 * receive a non-empty URL to surface.
 *
 * @internal
 */
const parseListedAttestations = (raw: unknown, owner: string, repo: string): ReadonlyArray<AttestationListEntry> => {
	const data = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
	const attestations =
		data && typeof data === "object" && "attestations" in data
			? (data as { attestations: ReadonlyArray<RawListedAttestation> | undefined }).attestations
			: undefined;
	if (!Array.isArray(attestations)) return [];

	const entries: AttestationListEntry[] = [];
	for (const entry of attestations) {
		const predicateType = predicateTypeFromBundle(entry);
		if (predicateType === null) continue;
		const attestationUrl =
			typeof entry.id === "number"
				? `https://github.com/${owner}/${repo}/attestations/${entry.id}`
				: typeof entry.bundle_url === "string" && entry.bundle_url.length > 0
					? entry.bundle_url
					: `https://github.com/${owner}/${repo}/attestations`;
		entries.push({ attestationUrl, predicateType });
	}
	return entries;
};

/**
 * `true` when an Octokit-style HTTP error reports the subject digest
 * has no attestations.
 *
 * @remarks
 * GitHub returns 404 when no attestations exist for a subject.
 * Some deployments also serve 422 for invalid digest formats; we
 * treat both as "empty list" so the orchestrator skips writing only
 * when something is actually present, never because a probe failed.
 *
 * @internal
 */
const isEmptyListError = (cause: unknown): boolean => {
	if (cause === null || typeof cause !== "object") return false;
	const status = (cause as { status?: unknown }).status;
	return status === 404 || status === 422;
};

/**
 * Build an in-toto statement from input, mapping any failure to a typed
 * `AttestError` with `reason: "build"`. Shared by the `buildStatement` and
 * `buildBundle` methods and the `attestFromInput` flow so the try/catch
 * error-mapping lives in exactly one place.
 *
 * @internal
 */
const buildStatementEffect = (input: AttestInput): Effect.Effect<InTotoStatement, AttestError> =>
	Effect.try({
		try: () => buildStatement(input),
		catch: (cause) =>
			new AttestError({
				reason: "build",
				message: `Failed to build in-toto statement: ${cause instanceof Error ? cause.message : String(cause)}`,
				cause,
			}),
	});

/**
 * Core attest-from-input flow shared by `attest`, `sbom`, and
 * `provenance` — build the statement, sign it, POST to GitHub.
 *
 * @internal
 */
const attestFromInput = (
	input: AttestInput,
): Effect.Effect<
	AttestationRecord,
	AttestError,
	SigstoreSigner | import("../services/OidcTokenIssuer.js").OidcTokenIssuer | GitHubClient
> =>
	Effect.gen(function* () {
		const statement = yield* buildStatementEffect(input);

		const signer = yield* SigstoreSigner;
		const bundle = yield* signer.signStatement(statement).pipe(
			Effect.mapError(
				(cause) =>
					new AttestError({
						reason: "sign",
						message: cause.message,
						cause,
					}),
			),
		);

		const client = yield* GitHubClient;
		const { owner, repo } = yield* client.repo.pipe(
			Effect.mapError(
				(cause) =>
					new AttestError({
						reason: "upload",
						message: `Failed to resolve repo context: ${cause.reason}`,
						cause,
					}),
			),
		);

		// Flatten the bundle to a pure JSON value for the request body: the
		// round-trip drops any class prototypes and non-JSON fields from the
		// in-memory `@sigstore/bundle` object so only wire-safe data is POSTed.
		const bundlePayload = JSON.parse(JSON.stringify(bundle)) as Record<string, unknown>;
		const attestationId = yield* client
			.rest("repos.createAttestation", async (octokit) => {
				if (!isOctokitLike(octokit)) {
					throw new Error("GitHubClient did not provide an Octokit-compatible client");
				}
				const response = await octokit.request(CREATE_ATTESTATION_REQUEST, {
					owner,
					repo,
					bundle: bundlePayload,
				});
				return { data: attestationIdFromResponse(response.data) };
			})
			.pipe(
				Effect.mapError(
					(cause) =>
						new AttestError({
							reason: "upload",
							message: `Failed to persist attestation: ${cause.reason}`,
							cause,
						}),
				),
			);

		const record: AttestationRecord = {
			statement,
			bundle,
			attestationId,
			attestationUrl: `https://github.com/${owner}/${repo}/attestations/${attestationId}`,
		};
		return record;
	});

/**
 * Live {@link Attest} layer.
 *
 * @public
 */
export const AttestLive = Layer.succeed(Attest, {
	buildStatement: (input) => buildStatementEffect(input),

	save: (data: InTotoStatement | SigstoreBundle, path: string) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const serialized = data instanceof InTotoStatement ? serializeStatement(data) : JSON.stringify(data, null, 2);
			yield* fs.writeFileString(path, serialized).pipe(
				Effect.mapError(
					(error) =>
						new AttestError({
							reason: "save",
							message: `Failed to write ${path}: ${error.message}`,
							cause: error,
						}),
				),
			);
		}),

	buildBundle: (input) =>
		Effect.gen(function* () {
			const statement = yield* buildStatementEffect(input);
			const signer = yield* SigstoreSigner;
			return yield* signer.signStatement(statement).pipe(
				Effect.mapError(
					(cause) =>
						new AttestError({
							reason: "sign",
							message: cause.message,
							cause,
						}),
				),
			);
		}),

	attest: (input) => attestFromInput(input),

	sbom: (input) =>
		Effect.gen(function* () {
			// Caller may supply EITHER `bomDocument` (attest the pre-built BOM
			// verbatim) OR `dependencies` (build a fresh BOM via the Sbom service
			// and attest that). When both are absent we fall back to the original
			// empty-deps behaviour with a debug warning — keeps existing callers
			// working mid-migration without quietly producing an empty SBOM.
			let predicate: unknown;
			if (input.bomDocument !== undefined) {
				predicate = input.bomDocument;
			} else {
				if (input.dependencies === undefined) {
					yield* Effect.logDebug(
						"[Attest.sbom] neither `bomDocument` nor `dependencies` supplied; building an empty-deps BOM. New callers should provide one of the two.",
					);
				}
				const sbomService = yield* Sbom;
				// Build the SbomInput by spreading only the defined optional
				// fields so `exactOptionalPropertyTypes` accepts the call.
				const sbomInput = {
					rootName: input.rootName,
					rootVersion: input.rootVersion,
					...(input.rootLicense !== undefined ? { rootLicense: input.rootLicense } : {}),
					...(input.rootDescription !== undefined ? { rootDescription: input.rootDescription } : {}),
					...(input.rootAuthor !== undefined ? { rootAuthor: input.rootAuthor } : {}),
					...(input.supplier !== undefined ? { supplier: input.supplier } : {}),
					...(input.authors !== undefined ? { authors: input.authors } : {}),
					dependencies: input.dependencies ?? [],
					...(input.inFlightPackages !== undefined ? { inFlightPackages: input.inFlightPackages } : {}),
				};
				const bom = yield* sbomService.generate(sbomInput).pipe(
					Effect.mapError(
						(cause) =>
							new AttestError({
								reason: "build",
								message: `Failed to generate SBOM: ${cause.message}`,
								cause,
							}),
					),
				);
				const bomJson = yield* sbomService.serializeJson(bom).pipe(
					Effect.mapError(
						(cause) =>
							new AttestError({
								reason: "build",
								message: `Failed to serialize SBOM: ${cause.message}`,
								cause,
							}),
					),
				);
				predicate = JSON.parse(bomJson) as unknown;
			}

			return yield* attestFromInput({
				subjects: [makeSubject(npmPurl(input.rootName, input.rootVersion), input.subjectSha256)],
				predicateType: CYCLONEDX_BOM,
				predicate,
			});
		}),

	provenance: (input) =>
		attestFromInput({
			subjects: [makeSubject(input.subjectName, input.subjectSha256)],
			predicateType: SLSA_PROVENANCE_V1,
			predicate: input.predicate,
		}),

	listForSubject: (subjectSha256, options) =>
		Effect.gen(function* () {
			const client = yield* GitHubClient;
			const { owner, repo } = yield* client.repo.pipe(
				Effect.mapError(
					(cause) =>
						new AttestError({
							reason: "upload",
							message: `Failed to resolve repo context: ${cause.reason}`,
							cause,
						}),
				),
			);

			// GitHub's filter accepts the short aliases `provenance` / `sbom`
			// or a freeform predicate-type URI. The orchestrator passes the
			// full URI; we forward it unchanged so future filter tokens
			// pass through transparently.
			const predicateTypeFilter = options?.predicateType;
			const entries = yield* client
				.rest("repos.listAttestations", async (octokit) => {
					if (!isOctokitLike(octokit)) {
						throw new Error("GitHubClient did not provide an Octokit-compatible client");
					}
					try {
						// `predicate_type` query parameter is deprecated as of
						// 2026-03-10 and scheduled for removal 2028-03-10. We
						// already filter client-side below (the canonical match
						// because some predicates carry the freeform URI rather
						// than the short alias the server accepts), so we omit
						// the query entirely — the endpoint returns every
						// attestation for the subject digest and the loop
						// downstream selects the matching one.
						const response = await octokit.request(LIST_ATTESTATIONS_REQUEST, {
							owner,
							repo,
							subject_digest: `sha256:${subjectSha256}`,
						});
						return { data: parseListedAttestations(response.data, owner, repo) };
					} catch (cause) {
						if (isEmptyListError(cause)) {
							return { data: [] as ReadonlyArray<AttestationListEntry> };
						}
						throw cause;
					}
				})
				.pipe(
					Effect.mapError(
						(cause) =>
							new AttestError({
								reason: "upload",
								message: `Failed to list attestations: ${cause.reason}`,
								cause,
							}),
					),
				);

			// Server-side `predicate_type` is advisory — some attestations
			// carry the freeform URI variant that the short-alias filter
			// does not catch. Re-filter client-side on the parsed in-toto
			// predicateType for an authoritative match.
			if (predicateTypeFilter === undefined) return entries;
			return entries.filter((e) => e.predicateType === predicateTypeFilter);
		}),
});
