import { Effect, Layer } from "effect";
import { DryRun } from "../services/DryRun.js";

/**
 * Live DryRun layer.
 *
 * @public
 */
export const DryRunLive = (enabled: boolean): Layer.Layer<DryRun> =>
	Layer.succeed(DryRun, {
		isDryRun: Effect.succeed(enabled),
		guard: <A, E, R>(label: string, effect: Effect.Effect<A, E, R>, fallback: A) =>
			enabled ? Effect.logInfo(`[DRY-RUN] ${label}`).pipe(Effect.map(() => fallback)) : effect,
	});
