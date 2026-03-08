import type { Effect } from "effect";
import { Context } from "effect";

/**
 * Service interface for dry-run mutation interception.
 *
 * @public
 */
export interface DryRun {
	readonly isDryRun: Effect.Effect<boolean>;
	readonly guard: <A, E, R>(label: string, effect: Effect.Effect<A, E, R>, fallback: A) => Effect.Effect<A, E, R>;
}

/**
 * DryRun tag for dependency injection.
 *
 * @public
 */
export const DryRun = Context.GenericTag<DryRun>("DryRun");
