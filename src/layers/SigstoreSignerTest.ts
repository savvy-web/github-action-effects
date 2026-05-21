import { Effect, Layer } from "effect";
import { SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE, SigstoreBundle } from "../schemas/Attestation.js";
import { SigstoreSigner } from "../services/SigstoreSigner.js";

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

/**
 * Noop SigstoreSigner test layer — returns a synthetic SigstoreBundle
 * without any signing or witnessing.
 *
 * @public
 */
export const SigstoreSignerTest: Layer.Layer<SigstoreSigner> = Layer.succeed(SigstoreSigner, {
	signStatement: () => Effect.succeed(stubBundle()),
});
