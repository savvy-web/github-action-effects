/**
 * Item-4 test: `Schema.encode(SigstoreBundle)` produces the same wire shape as
 * the prior `JSON.parse(JSON.stringify(bundle))` round-trip used in `AttestLive`.
 */

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE, SigstoreBundle } from "../testing.js";

const stubBundle = (): SigstoreBundle =>
	new SigstoreBundle({
		mediaType: SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE,
		verificationMaterial: {
			tlogEntries: [{ logIndex: "42", canonicalizedBody: "Ym9keQ==" }],
			certificate: { rawBytes: "Y2VydA==" },
		},
		dsseEnvelope: {
			payload: "base64-payload",
			payloadType: "application/vnd.in-toto+json",
			signatures: [{ sig: "c2ln" }],
		},
	});

describe("SigstoreBundle encode", () => {
	it("encodes the SigstoreBundle to the same wire shape as the JSON round-trip", () => {
		const bundle = stubBundle();
		const jsonRoundTrip = JSON.parse(JSON.stringify(bundle));
		const encoded = Effect.runSync(Schema.encode(SigstoreBundle)(bundle));
		expect(encoded).toEqual(jsonRoundTrip);
	});

	it("preserves the mediaType literal and the opaque material/envelope payloads", () => {
		const bundle = stubBundle();
		const encoded = Effect.runSync(Schema.encode(SigstoreBundle)(bundle)) as Record<string, unknown>;
		expect(encoded.mediaType).toBe(SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE);
		expect(encoded.verificationMaterial).toEqual(bundle.verificationMaterial);
		expect(encoded.dsseEnvelope).toEqual(bundle.dsseEnvelope);
	});
});
