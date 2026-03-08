import { Context, Effect, Exit, Layer, Option, Tracer } from "effect";
import type { Span as TracerSpan } from "effect/Tracer";

/**
 * A completed span record captured by the InMemoryTracer.
 *
 * @public
 */
export interface CompletedSpan {
	readonly name: string;
	readonly startTime: number;
	readonly endTime: number;
	readonly duration: number;
	readonly parentName: string | undefined;
	readonly status: "ok" | "error";
	readonly attributes: Record<string, string>;
}

/**
 * Tag for the span store, used internally to share state
 * between the Tracer and user code.
 */
const SpanStore = Context.GenericTag<ReadonlyArray<CompletedSpan>>("InMemoryTracer/SpanStore");

const randomHex = (length: number): string => {
	const chars = "abcdef0123456789";
	let result = "";
	for (let i = 0; i < length; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return result;
};

const makeSpan = (
	name: string,
	parent: Option.Option<Tracer.AnySpan>,
	context: Context.Context<never>,
	links: ReadonlyArray<Tracer.SpanLink>,
	startTime: bigint,
	kind: Tracer.SpanKind,
	store: Array<CompletedSpan>,
): TracerSpan => {
	const attributes = new Map<string, unknown>();
	const spanLinks = Array.from(links);
	let status: Tracer.SpanStatus = { _tag: "Started", startTime };

	const parentName = Option.isSome(parent) && parent.value._tag === "Span" ? parent.value.name : undefined;

	return {
		_tag: "Span",
		name,
		spanId: randomHex(16),
		traceId: Option.isSome(parent) ? parent.value.traceId : randomHex(32),
		parent,
		context,
		get status() {
			return status;
		},
		get attributes() {
			return attributes;
		},
		links: spanLinks,
		sampled: true,
		kind,
		end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
			status = { _tag: "Ended", startTime, endTime, exit };

			const startMs = Number(startTime) / 1_000_000;
			const endMs = Number(endTime) / 1_000_000;

			const attrs: Record<string, string> = {};
			for (const [key, value] of attributes) {
				attrs[key] = String(value);
			}

			store.push({
				name,
				startTime: startMs,
				endTime: endMs,
				duration: endMs - startMs,
				parentName,
				status: Exit.isSuccess(exit) ? "ok" : "error",
				attributes: attrs,
			});
		},
		attribute(key: string, value: unknown): void {
			attributes.set(key, value);
		},
		event(_name: string, _startTime: bigint, _attributes?: Record<string, unknown>): void {
			// Events are not captured by this tracer
		},
		addLinks(newLinks: ReadonlyArray<Tracer.SpanLink>): void {
			spanLinks.push(...newLinks);
		},
	};
};

/**
 * Build a fresh layer. Each call creates its own mutable store so that
 * separate `Effect.provide(InMemoryTracer.layer)` invocations are isolated.
 *
 * Uses `Layer.unwrapEffect` so the store + tracer are created lazily when
 * the layer is first used.
 */
const freshLayer: Layer.Layer<typeof SpanStore.Service> = Layer.unwrapEffect(
	Effect.sync(() => {
		const store: Array<CompletedSpan> = [];

		const tracer = Tracer.make({
			span: (name, parent, context, links, startTime, kind) =>
				makeSpan(name, parent, context, links, startTime, kind, store),
			context: (f) => f(),
		});

		return Layer.mergeAll(Layer.setTracer(tracer), Layer.succeed(SpanStore, store as ReadonlyArray<CompletedSpan>));
	}),
);

/**
 * InMemoryTracer captures spans created by `Effect.withSpan` in memory
 * for later retrieval. Useful for testing and for rendering telemetry
 * as GitHub step summaries or PR comments.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   yield* Effect.succeed(42).pipe(Effect.withSpan("my-operation"));
 *   return yield* InMemoryTracer.getSpans();
 * });
 *
 * const spans = await Effect.runPromise(
 *   program.pipe(Effect.provide(InMemoryTracer.layer)),
 * );
 * ```
 *
 * @public
 */
export const InMemoryTracer = {
	/**
	 * A layer that installs the InMemoryTracer and provides the span store.
	 * The mutable array is shared between the Tracer (which writes to it
	 * synchronously in `span.end()`) and `getSpans()` (which reads it).
	 */
	layer: freshLayer,

	/**
	 * Retrieve all completed spans recorded so far.
	 */
	getSpans: (): Effect.Effect<ReadonlyArray<CompletedSpan>, never, typeof SpanStore.Service> => SpanStore,
} as const;

/**
 * Type alias for the context provided by InMemoryTracer.layer.
 */
export declare namespace InMemoryTracer {
	type Provides = typeof SpanStore.Service;
}
