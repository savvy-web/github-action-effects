import { Duration, Effect, Layer, Metric, Option, Ref, Schedule } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";
import { RateLimitError } from "../errors/RateLimitError.js";
import { rateLimitHits } from "../runtime/Telemetry.js";
import type { RateLimitStatus } from "../schemas/RateLimit.js";
import { GitHubClient } from "../services/GitHubClient.js";
import { RateLimiter } from "../services/RateLimiter.js";
import type { RateLimitSnapshot } from "../services/RateLimitState.js";
import { RateLimitState } from "../services/RateLimitState.js";

/** Minimal Octokit shape for rate limit API calls. */
interface OctokitRateLimit {
	readonly rest: {
		readonly rateLimit: {
			readonly get: () => Promise<{
				data: {
					resources: {
						core: RateLimitStatus;
						graphql: RateLimitStatus;
					};
				};
			}>;
		};
	};
}

const asRateLimit = (octokit: unknown): OctokitRateLimit => octokit as OctokitRateLimit;

/** Project an internal snapshot onto the public `RateLimitStatus` schema. */
const snapshotToStatus = (snapshot: RateLimitSnapshot): RateLimitStatus => ({
	limit: snapshot.limit,
	remaining: snapshot.remaining,
	reset: snapshot.resetEpochSeconds,
	used: Math.max(0, snapshot.limit - snapshot.remaining),
});

/**
 * Rate limiter that reads the `x-ratelimit-*` headers observed on real
 * responses (cached in a shared `RateLimitState` `Ref` written by the
 * GitHubClient), rather than issuing a pre-flight `GET /rate_limit` before every
 * guarded call. Probes only on a cache miss.
 */
export const RateLimiterLive: Layer.Layer<RateLimiter, never, GitHubClient> = Layer.effect(
	RateLimiter,
	Effect.gen(function* () {
		const client = yield* GitHubClient;
		// Use the app-provided shared snapshot when present (so the client's
		// observed headers drive the policy); otherwise fall back to a private
		// empty Ref so the limiter is self-contained and adds no build requirement.
		const snapshotRef = yield* Effect.flatMap(Effect.serviceOption(RateLimitState), (maybe) =>
			Option.isSome(maybe) ? Effect.succeed(maybe.value) : Ref.make(Option.none<RateLimitSnapshot>()),
		);

		/** Fetch all rate limit resources via the REST API (the cache-miss probe). */
		const fetchRateLimits = () => client.rest("rate_limit", (octokit) => asRateLimit(octokit).rest.rateLimit.get());

		const checkRest = (): Effect.Effect<RateLimitStatus, GitHubClientError> =>
			Effect.flatMap(Ref.get(snapshotRef), (cached) =>
				Option.isSome(cached)
					? Effect.succeed(snapshotToStatus(cached.value))
					: fetchRateLimits().pipe(
							Effect.map((data) => {
								const typed = data as { resources: { core: RateLimitStatus } };
								return typed.resources.core;
							}),
						),
			);

		const checkGraphQL = (): Effect.Effect<RateLimitStatus, GitHubClientError> =>
			Effect.flatMap(Ref.get(snapshotRef), (cached) =>
				Option.isSome(cached)
					? Effect.succeed(snapshotToStatus(cached.value))
					: fetchRateLimits().pipe(
							Effect.map((data) => {
								const typed = data as { resources: { graphql: RateLimitStatus } };
								return typed.resources.graphql;
							}),
						),
			);

		return {
			checkRest,
			checkGraphQL,

			withRateLimit: <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | RateLimitError, R> => {
				/** Count a low-quota event, tagged by the reaction taken. */
				const countHit = (action: "slept" | "failed") =>
					Metric.update(rateLimitHits.pipe(Metric.tagged("api", "rest"), Metric.tagged("action", action)), 1);

				return Effect.flatMap(Ref.get(snapshotRef), (cached): Effect.Effect<A, E | RateLimitError, R> => {
					// Never observed yet → run directly; the first real call will
					// populate the snapshot for subsequent guards (no wasted probe).
					if (Option.isNone(cached)) {
						return effect;
					}
					const snapshot = cached.value;
					const threshold = Math.ceil(snapshot.limit * 0.1);
					if (snapshot.remaining > threshold) {
						return effect;
					}
					const resetDate = new Date(snapshot.resetEpochSeconds * 1000);
					const waitMs = Math.max(0, resetDate.getTime() - Date.now());
					if (waitMs > 60000) {
						return countHit("failed").pipe(
							Effect.flatMap(() =>
								Effect.fail(
									new RateLimitError({
										api: "rest",
										remaining: snapshot.remaining,
										resetAt: resetDate.toISOString(),
										reason: `Rate limit nearly exhausted (${snapshot.remaining}/${snapshot.limit}). Resets at ${resetDate.toISOString()}`,
									}),
								),
							),
						);
					}
					return countHit("slept").pipe(
						Effect.flatMap(() => Effect.sleep(Duration.millis(waitMs))),
						Effect.flatMap(() => effect),
					);
				}).pipe(Effect.withSpan("RateLimiter.withRateLimit"));
			},

			withRetry: <A, E, R>(
				effect: Effect.Effect<A, E, R>,
				options?: { readonly maxRetries?: number; readonly baseDelay?: number },
			) => {
				const maxRetries = options?.maxRetries ?? 3;
				const baseDelay = options?.baseDelay ?? 1000;
				return effect.pipe(
					Effect.retry(
						Schedule.exponential(Duration.millis(baseDelay)).pipe(Schedule.compose(Schedule.recurs(maxRetries))),
					),
				);
			},
		};
	}),
);
