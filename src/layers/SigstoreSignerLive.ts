/**
 * Sigstore signing service — wraps `@sigstore/sign` behind an Effect
 * surface so the bundle-building path is testable without hitting Fulcio
 * or Rekor.
 *
 * @remarks
 * The Live implementation uses {@link DSSEBundleBuilder} with a
 * {@link FulcioSigner} (driven by the {@link OidcTokenIssuer}-issued JWT)
 * and a {@link RekorWitness} pointing at the public-good sigstore
 * instance. Callers that need to override the Fulcio / Rekor URLs (e.g.
 * for staging) can compose a configured Live layer instead — exposed
 * via {@link makeSigstoreSignerLive}.
 *
 * The DSSE payload type is fixed to `application/vnd.in-toto+json` per
 * the GitHub attestations spec.
 */

import type { Bundle, BundleWithDsseEnvelope, SerializedBundle } from "@sigstore/bundle";
import { bundleToJSON } from "@sigstore/bundle";
import type { IdentityProvider } from "@sigstore/sign";
import { DSSEBundleBuilder, FulcioSigner, RekorWitness } from "@sigstore/sign";
import { Effect, Layer, Redacted } from "effect";
import { SigstoreSignerError } from "../errors/SigstoreSignerError.js";
import { SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE, SigstoreBundle } from "../schemas/Attestation.js";
import { OidcTokenIssuer } from "../services/OidcTokenIssuer.js";
import type { SigstoreSignerConfig } from "../services/SigstoreSigner.js";
import { IN_TOTO_PAYLOAD_TYPE, SIGSTORE_OIDC_AUDIENCE, SigstoreSigner } from "../services/SigstoreSigner.js";
import { serializeStatement } from "../utils/intoto.js";

/**
 * Format a `@sigstore/sign` error with its full cause chain.
 *
 * @remarks
 * `InternalError` (Fulcio / Rekor failures) wraps the underlying
 * transport error in `cause`. The default `Error.message` only shows
 * the outermost layer ("error creating signing certificate"), which is
 * useless for diagnosing real-world failures. Walk the chain and pull
 * out HTTP status / response body where available so the action log
 * shows what Fulcio actually said.
 *
 * @internal
 */
const describeSigstoreError = (err: unknown, depth = 0): string => {
	if (!err || depth > 4) return String(err);
	if (typeof err !== "object") return String(err);
	const e = err as {
		name?: string;
		code?: string;
		message?: string;
		cause?: unknown;
		statusCode?: number;
		status?: number;
		stack?: string;
	};
	const parts: string[] = [];
	if (e.code) parts.push(`[${e.code}]`);
	if (e.statusCode ?? e.status) parts.push(`(HTTP ${e.statusCode ?? e.status})`);
	parts.push(e.message ?? e.name ?? String(err));
	// Include the first 3 stack frames for the leaf cause so a runtime
	// TypeError ("Right-hand side of 'instanceof' is not callable") tells
	// us *which* file/line in the bundled action threw it.
	if (e.stack && (!e.cause || e.cause === err)) {
		const firstFrames = e.stack
			.split("\n")
			.slice(1, 4)
			.map((line) => line.trim())
			.join(" | ");
		if (firstFrames) parts.push(`@ ${firstFrames}`);
	}
	if (e.cause && e.cause !== err) {
		parts.push(`← ${describeSigstoreError(e.cause, depth + 1)}`);
	}
	return parts.join(" ");
};

/**
 * Convert a {@link Bundle} (protobuf shape) to a validated
 * {@link SigstoreBundle} (our Schema.Class).
 *
 * @internal
 */
const toSigstoreBundle = (bundle: BundleWithDsseEnvelope): Effect.Effect<SigstoreBundle, SigstoreSignerError> =>
	Effect.try({
		try: () => {
			const serialized = bundleToJSON(bundle as Bundle) as SerializedBundle;
			return new SigstoreBundle({
				mediaType: SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE,
				verificationMaterial: serialized.verificationMaterial,
				dsseEnvelope: serialized.dsseEnvelope,
			});
		},
		catch: (cause) =>
			new SigstoreSignerError({
				reason: "bundle",
				message: `Failed to serialize Sigstore bundle: ${cause instanceof Error ? cause.message : String(cause)}`,
				cause,
			}),
	});

/**
 * Build a configured Live {@link SigstoreSigner} layer.
 *
 * @public
 */
export const makeSigstoreSignerLive = (config: SigstoreSignerConfig = {}): Layer.Layer<SigstoreSigner> =>
	Layer.succeed(SigstoreSigner, {
		signStatement: (statement) =>
			Effect.gen(function* () {
				const issuer = yield* OidcTokenIssuer;
				const tokenRedacted = yield* issuer.getToken(SIGSTORE_OIDC_AUDIENCE).pipe(
					Effect.mapError(
						(cause) =>
							new SigstoreSignerError({
								reason: "sign",
								message: `Failed to obtain OIDC token for Sigstore: ${cause.message}`,
								cause,
							}),
					),
				);
				const tokenValue = Redacted.value(tokenRedacted);

				const identityProvider: IdentityProvider = { getToken: () => Promise.resolve(tokenValue) };
				const signer = new FulcioSigner({
					identityProvider,
					...(config.fulcioBaseURL ? { fulcioBaseURL: config.fulcioBaseURL } : {}),
				});
				const witness = new RekorWitness({
					entryType: "dsse",
					...(config.rekorBaseURL ? { rekorBaseURL: config.rekorBaseURL } : {}),
				});
				const builder = new DSSEBundleBuilder({ signer, witnesses: [witness] });

				const payload = Buffer.from(serializeStatement(statement), "utf-8");
				const bundle = yield* Effect.tryPromise({
					try: () => builder.create({ data: payload, type: IN_TOTO_PAYLOAD_TYPE }),
					catch: (cause) =>
						new SigstoreSignerError({
							reason: "sign",
							message: `Sigstore bundle build failed: ${describeSigstoreError(cause)}`,
							cause,
						}),
				});

				return yield* toSigstoreBundle(bundle);
			}),
	});

/**
 * Live {@link SigstoreSigner} layer using the public-good Sigstore
 * instance (Fulcio + Rekor). Requires {@link OidcTokenIssuer} to be
 * provided downstream.
 *
 * @public
 */
export const SigstoreSignerLive = makeSigstoreSignerLive();
