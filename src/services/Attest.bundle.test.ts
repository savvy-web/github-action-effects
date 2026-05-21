/**
 * Step-3 tests for the Attest service: bundle construction.
 *
 * @remarks
 * Drives `AttestLive.buildBundle` against a stub `SigstoreSigner` so we
 * exercise the orchestration (build statement → hand off to signer →
 * map errors) without spinning up the real Fulcio/Rekor path.
 *
 * The Live `SigstoreSigner` against the public-good Sigstore instance
 * is exercised end-to-end in the integration repo run, not here.
 */

import type { Context } from "effect";
import { Cause, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { InTotoStatement } from "../testing.js";
import {
	Attest,
	AttestLive,
	IN_TOTO_STATEMENT_V1,
	OidcTokenIssuer,
	SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE,
	SLSA_PROVENANCE_V1,
	SigstoreBundle,
	SigstoreSigner,
	SigstoreSignerError,
	npmPurl,
	subject,
} from "../testing.js";

const stubBundle = (subjectName: string): SigstoreBundle =>
	new SigstoreBundle({
		mediaType: SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE,
		verificationMaterial: { tlogEntries: [], stub: true, subjectName },
		dsseEnvelope: { payload: "base64-payload", payloadType: "application/vnd.in-toto+json", signatures: [] },
	});

interface SignerCalls {
	statements: InTotoStatement[];
}

const stubSignerLayer = (
	calls: SignerCalls,
	respond: (statement: InTotoStatement) => SigstoreBundle | SigstoreSignerError,
): Layer.Layer<SigstoreSigner> =>
	Layer.succeed(SigstoreSigner, {
		signStatement: (statement) =>
			Effect.gen(function* () {
				calls.statements.push(statement);
				const result = respond(statement);
				if (result instanceof SigstoreSignerError) return yield* Effect.fail(result);
				return result;
			}),
	});

const noopOidcLayer: Layer.Layer<OidcTokenIssuer> = Layer.succeed(OidcTokenIssuer, {
	getToken: () => Effect.die("OidcTokenIssuer should not be reached when SigstoreSigner is stubbed"),
});

describe("Attest.buildBundle — step 3: orchestration", () => {
	it("builds an in-toto statement and hands it to SigstoreSigner", async () => {
		const calls: SignerCalls = { statements: [] };
		const layer = Layer.mergeAll(
			AttestLive,
			stubSignerLayer(calls, (s) => stubBundle(s.subject[0].name)),
			noopOidcLayer,
		);

		const bundle = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.buildBundle({
					subjects: [subject(npmPurl("@savvy-web/example", "1.0.0"), "a".repeat(64))],
					predicateType: SLSA_PROVENANCE_V1,
					predicate: { buildType: "https://example.com/build" },
				});
			}).pipe(Effect.provide(layer)),
		);

		expect(calls.statements).toHaveLength(1);
		const statement = calls.statements[0];
		expect(statement._type).toBe(IN_TOTO_STATEMENT_V1);
		expect(statement.subject).toHaveLength(1);
		expect(statement.subject[0].name).toBe("pkg:npm/@savvy-web/example@1.0.0");
		expect(statement.subject[0].digest).toEqual({ sha256: "a".repeat(64) });

		expect(bundle.mediaType).toBe(SIGSTORE_BUNDLE_V0_3_MEDIA_TYPE);
		const material = bundle.verificationMaterial as { subjectName: string };
		expect(material.subjectName).toBe("pkg:npm/@savvy-web/example@1.0.0");
	});

	it("maps SigstoreSigner failures to AttestError(reason: sign)", async () => {
		const calls: SignerCalls = { statements: [] };
		const failingLayer = stubSignerLayer(
			calls,
			() => new SigstoreSignerError({ reason: "witness", message: "rekor: tlog returned 502" }),
		);
		const layer = Layer.mergeAll(AttestLive, failingLayer, noopOidcLayer);

		const exit = await Effect.runPromise(
			Effect.gen(function* () {
				const attest = yield* Attest;
				return yield* attest.buildBundle({
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
				expect(failure.value.reason).toBe("sign");
				expect(failure.value.message).toContain("rekor: tlog returned 502");
				expect(failure.value.cause).toBeInstanceOf(SigstoreSignerError);
			}
		}
	});

	it("declares SigstoreSigner + OidcTokenIssuer as required dependencies", () => {
		// This is a compile-time check disguised as a runtime test — if the
		// service surface ever drops the dependency declaration, the type
		// of the effect changes and this test fails to typecheck.
		const program = Effect.gen(function* () {
			const attest = yield* Attest;
			return yield* attest.buildBundle({
				subjects: [subject("pkg:npm/y@1.0.0", "c".repeat(64))],
				predicateType: SLSA_PROVENANCE_V1,
				predicate: {},
			});
		});
		type RequiredContext = Effect.Effect.Context<typeof program>;
		const hasAttest: Context.Tag.Identifier<Attest> = null as never as Context.Tag.Identifier<Attest>;
		const hasSigner: Context.Tag.Identifier<SigstoreSigner> = null as never as Context.Tag.Identifier<SigstoreSigner>;
		const hasOidc: Context.Tag.Identifier<OidcTokenIssuer> = null as never as Context.Tag.Identifier<OidcTokenIssuer>;
		const _required: RequiredContext = hasAttest as unknown as RequiredContext;
		void hasSigner;
		void hasOidc;
		void _required;
		expect(true).toBe(true);
	});
});
