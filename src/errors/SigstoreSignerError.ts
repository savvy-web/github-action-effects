import { Data } from "effect";

/**
 * Errors raised by SigstoreSigner.
 *
 * - `"sign"`    — Fulcio / FulcioSigner failed to produce a signature
 * - `"witness"` — Rekor failed to issue a transparency-log entry
 * - `"bundle"`  — bundle JSON could not be produced from the protobuf
 *
 * @public
 */
export class SigstoreSignerError extends Data.TaggedError("SigstoreSignerError")<{
	readonly reason: "sign" | "witness" | "bundle";
	readonly message: string;
	readonly cause?: unknown;
}> {}
