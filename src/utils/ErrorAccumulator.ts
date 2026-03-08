import { Effect } from "effect";

/**
 * Result of an accumulate operation.
 * @public
 */
export interface AccumulateResult<A, B, E> {
	readonly successes: ReadonlyArray<B>;
	readonly failures: ReadonlyArray<{ readonly item: A; readonly error: E }>;
}

/**
 * Namespace for error-accumulating operations.
 *
 * Processes all items and collects both successes and failures
 * without short-circuiting on first error.
 *
 * @public
 */
export const ErrorAccumulator = {
	/**
	 * Process all items sequentially, collecting successes and failures.
	 * The error channel is `never` — all errors are captured in the failures array.
	 */
	forEachAccumulate: <A, B, E, R>(
		items: Iterable<A>,
		fn: (item: A) => Effect.Effect<B, E, R>,
	): Effect.Effect<AccumulateResult<A, B, E>, never, R> =>
		Effect.forEach(Array.from(items), (item) =>
			fn(item).pipe(
				Effect.map((value): { readonly _tag: "success"; readonly value: B } => ({
					_tag: "success",
					value,
				})),
				Effect.catchAll((error: E) =>
					Effect.succeed({
						_tag: "failure" as const,
						item,
						error,
					}),
				),
			),
		).pipe(
			Effect.map((results) => {
				const successes: Array<B> = [];
				const failures: Array<{ item: A; error: E }> = [];
				for (const r of results) {
					if (r._tag === "success") {
						successes.push(r.value);
					} else {
						failures.push({ item: r.item, error: r.error });
					}
				}
				return { successes, failures };
			}),
		),

	/**
	 * Process all items with concurrency control, collecting successes and failures.
	 * The error channel is `never` — all errors are captured in the failures array.
	 */
	forEachAccumulateConcurrent: <A, B, E, R>(
		items: Iterable<A>,
		fn: (item: A) => Effect.Effect<B, E, R>,
		concurrency: number,
	): Effect.Effect<AccumulateResult<A, B, E>, never, R> =>
		Effect.forEach(
			Array.from(items),
			(item) =>
				fn(item).pipe(
					Effect.map((value): { readonly _tag: "success"; readonly value: B } => ({
						_tag: "success",
						value,
					})),
					Effect.catchAll((error: E) =>
						Effect.succeed({
							_tag: "failure" as const,
							item,
							error,
						}),
					),
				),
			{ concurrency },
		).pipe(
			Effect.map((results) => {
				const successes: Array<B> = [];
				const failures: Array<{ item: A; error: E }> = [];
				for (const r of results) {
					if (r._tag === "success") {
						successes.push(r.value);
					} else {
						failures.push({ item: r.item, error: r.error });
					}
				}
				return { successes, failures };
			}),
		),
} as const;
