import type { Effect } from "effect";
import { Context } from "effect";
import type { CheckRunError } from "../errors/CheckRunError.js";

/**
 * Check run conclusion.
 *
 * @public
 */
export type CheckRunConclusion =
	| "success"
	| "failure"
	| "neutral"
	| "cancelled"
	| "skipped"
	| "timed_out"
	| "action_required";

/**
 * Check run annotation level.
 *
 * @public
 */
export type AnnotationLevel = "notice" | "warning" | "failure";

/**
 * A single annotation on a check run.
 *
 * @public
 */
export interface CheckRunAnnotation {
	readonly path: string;
	readonly start_line: number;
	readonly end_line: number;
	readonly annotation_level: AnnotationLevel;
	readonly message: string;
	readonly title?: string;
}

/**
 * Output content for a check run.
 *
 * @public
 */
export interface CheckRunOutput {
	readonly title: string;
	readonly summary: string;
	readonly text?: string;
	readonly annotations?: ReadonlyArray<CheckRunAnnotation>;
}

/**
 * Service interface for GitHub check run operations.
 *
 * @public
 */
export interface CheckRun {
	/** Create a new check run. Returns the check run ID. */
	readonly create: (name: string, headSha: string) => Effect.Effect<number, CheckRunError>;

	/** Update an in-progress check run with output. */
	readonly update: (checkRunId: number, output: CheckRunOutput) => Effect.Effect<void, CheckRunError>;

	/** Complete a check run with a conclusion and optional final output. */
	readonly complete: (
		checkRunId: number,
		conclusion: CheckRunConclusion,
		output?: CheckRunOutput,
	) => Effect.Effect<void, CheckRunError>;

	/**
	 * Bracket pattern: create check run, run effect, then complete.
	 * On success, completes with "success". On failure, completes with "failure".
	 */
	readonly withCheckRun: <A, E>(
		name: string,
		headSha: string,
		effect: (checkRunId: number) => Effect.Effect<A, E>,
	) => Effect.Effect<A, E | CheckRunError>;
}

/**
 * CheckRun tag for dependency injection.
 *
 * @public
 */
export const CheckRun = Context.GenericTag<CheckRun>("CheckRun");
