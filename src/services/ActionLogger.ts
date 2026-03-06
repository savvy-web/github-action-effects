import type { AnnotationProperties } from "@actions/core";
import type { Effect } from "effect";
import { Context } from "effect";

/**
 * Service interface for action-specific logging operations beyond the Effect Logger.
 *
 * @remarks
 * The core log-level routing is handled by the Effect Logger installed
 * via {@link ActionLoggerLayer}. This service provides additional
 * GitHub Actions-specific operations like log groups and buffering.
 *
 * @public
 */
export interface ActionLogger {
	/**
	 * Run an effect inside a collapsible log group.
	 */
	readonly group: <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

	/**
	 * Run an effect with buffered logging. At `info` level, verbose output
	 * is captured in memory. On success the buffer is discarded. On failure
	 * the buffer is flushed before the error is reported.
	 */
	readonly withBuffer: <A, E, R>(label: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;

	/**
	 * Emit a file/line annotation.
	 */
	readonly annotation: (message: string, properties?: AnnotationProperties) => Effect.Effect<void>;
}

/**
 * ActionLogger tag for dependency injection.
 *
 * @public
 */
export const ActionLogger = Context.GenericTag<ActionLogger>("ActionLogger");
