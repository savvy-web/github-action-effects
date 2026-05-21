import { Data } from "effect";

/**
 * Error from npm registry operations.
 */
export class NpmRegistryError extends Data.TaggedError("NpmRegistryError")<{
	readonly pkg: string;
	readonly operation: "view" | "search" | "versions";
	readonly reason: string;
}> {
	/**
	 * Human-readable summary: `[<operation>] <pkg>: <reason>`.
	 *
	 * @remarks
	 * `Data.TaggedError` does not synthesise a `message` getter — callers that
	 * read `error.message` would see an empty string otherwise. The publish
	 * orchestrator catches this error class into a generic `{ error: string }`
	 * shape via `e.message`; the explicit getter ensures that catch produces a
	 * useful message instead of swallowing the cause.
	 */
	get message(): string {
		return `[${this.operation}] ${this.pkg}: ${this.reason}`;
	}
}
