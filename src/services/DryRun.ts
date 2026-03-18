import type { Effect } from "effect";
import { Context } from "effect";

/**
 * Service for dry-run mutation interception.
 *
 * @public
 */
export class DryRun extends Context.Tag("github-action-effects/DryRun")<
	DryRun,
	{
		readonly isDryRun: Effect.Effect<boolean>;
		readonly guard: <A, E, R>(label: string, effect: Effect.Effect<A, E, R>, fallback: A) => Effect.Effect<A, E, R>;
	}
>() {}
