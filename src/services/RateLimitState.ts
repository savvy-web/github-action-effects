import { Context, Layer, Option, Ref } from "effect";

/**
 * Internal snapshot of the latest observed GitHub rate-limit headers.
 *
 * INTERNAL — never exported from a public barrel and never appears in a public
 * method signature. Shared between `GitHubClientLive` (the writer, which reads
 * `x-ratelimit-*` headers off real responses) and `RateLimiterLive` (the
 * reader, which applies the wait/fail policy).
 */
export interface RateLimitSnapshot {
	readonly remaining: number;
	readonly limit: number;
	readonly resetEpochSeconds: number;
	/** `Date.now()` at observation, for staleness checks. */
	readonly observedAt: number;
}

/**
 * Internal shared state holding the most recently observed rate-limit snapshot.
 *
 * INTERNAL — not exported from `index.ts` / `testing.ts`. Provided by both
 * `GitHubClientLive.*` and `RateLimiterLive` so the client can record headers
 * and the rate limiter can read them without a pre-flight probe.
 */
export class RateLimitState extends Context.Tag("github-action-effects/RateLimitState")<
	RateLimitState,
	Ref.Ref<Option.Option<RateLimitSnapshot>>
>() {
	/** Default layer seeding an empty (unobserved) snapshot. */
	static readonly Default: Layer.Layer<RateLimitState> = Layer.effect(
		RateLimitState,
		Ref.make(Option.none<RateLimitSnapshot>()),
	);
}
