import { Duration, Effect, Schedule } from "effect";
import type { GitHubClientError } from "../errors/GitHubClientError.js";

/**
 * Tuning for the resilient retry/backoff applied to every GitHubClient call.
 *
 * Resilience is on by default; pass `{ enabled: false }` for bare, retry-free
 * behavior. `maxRetries`, `baseDelay`, and `maxDelay` tune the exponential,
 * jittered, capped backoff schedule used for retryable (429 / 5xx) errors.
 *
 * @public
 */
export interface ResilienceOptions {
	/** Master switch. Default `true`. Set `false` for bare, retry-free behavior. */
	readonly enabled?: boolean;
	/** Max retry attempts for `retryable` errors. Default `4`. */
	readonly maxRetries?: number;
	/** Base delay for the exponential schedule. Default `Duration.seconds(1)`. */
	readonly baseDelay?: Duration.DurationInput;
	/** Cap on any single backoff delay. Default `Duration.seconds(30)`. */
	readonly maxDelay?: Duration.DurationInput;
}

const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_BASE_DELAY = Duration.seconds(1);
const DEFAULT_MAX_DELAY = Duration.seconds(30);

/**
 * Backoff schedule for retryable GitHubClient errors: exponential, jittered,
 * each interval capped at `maxDelay`, bounded by `maxRetries`, and gated so
 * that only `retryable` errors recur. Non-retryable errors stop the schedule
 * immediately.
 *
 * Exported for reuse by tracing spans and any future layer transformer. It is
 * pure (depends only on `effect` and the error type) so it is safe to import
 * from the octokit-free testing entry point.
 *
 * Note this differs from the internal `withResilience` (which wraps every
 * `GitHubClient` call) in two ways: it does NOT consult a
 * `GitHubClientError.retryAfterMs` server-advised delay, and it jitters with
 * `Schedule.jittered` (multiplicative) rather than `withResilience`'s uniform
 * full-jitter in `[0, capped]`. Use `Effect.retry(resilienceSchedule(...))` for
 * a standalone backoff; reach for `withResilience` directly when server-advised
 * `Retry-After` / `x-ratelimit-reset` delays must be honored.
 *
 * The per-interval cap is expressed with `Schedule.map((d) => Duration.min(d, cap))`
 * rather than `Schedule.either(Schedule.spaced(cap))`: `Duration.min` caps each
 * computed delay deterministically, which the cap test pins directly.
 *
 * @public
 */
export const resilienceSchedule = (options?: ResilienceOptions): Schedule.Schedule<unknown, GitHubClientError> => {
	const max = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
	const base = options?.baseDelay ?? DEFAULT_BASE_DELAY;
	const cap = Duration.decode(options?.maxDelay ?? DEFAULT_MAX_DELAY);
	return Schedule.exponential(base).pipe(
		Schedule.map((d) => Duration.min(d, cap)),
		Schedule.jittered,
		Schedule.whileInput((e: GitHubClientError) => e.retryable),
		Schedule.compose(Schedule.recurs(max)),
	);
};

/** Compute the exponential, jittered, capped backoff for a given retry attempt (0-based). */
const backoffMillis = (attempt: number, baseMs: number, capMs: number): number => {
	const raw = baseMs * 2 ** attempt;
	const capped = Math.min(raw, capMs);
	// Full jitter: a random delay in [0, capped].
	return Math.floor(Math.random() * capped);
};

/**
 * Wrap a single GitHubClient call with the resilient retry policy. On a
 * `retryable` error it waits for the server-advised `retryAfterMs` when present,
 * otherwise an exponential + jittered + capped backoff, retrying up to
 * `maxRetries` times. Non-retryable errors fail immediately. With
 * `{ enabled: false }` the effect runs once with no retry.
 */
export const withResilience = <T>(
	effect: Effect.Effect<T, GitHubClientError>,
	options?: ResilienceOptions,
): Effect.Effect<T, GitHubClientError> => {
	if (options?.enabled === false) {
		return effect;
	}
	const max = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
	const baseMs = Duration.toMillis(Duration.decode(options?.baseDelay ?? DEFAULT_BASE_DELAY));
	const capMs = Duration.toMillis(Duration.decode(options?.maxDelay ?? DEFAULT_MAX_DELAY));

	const loop = (attempt: number): Effect.Effect<T, GitHubClientError> =>
		effect.pipe(
			Effect.catchAll((error) => {
				if (!error.retryable || attempt >= max) {
					return Effect.fail(error);
				}
				// Server-advised delay takes precedence over the computed backoff.
				const waitMs = error.retryAfterMs ?? backoffMillis(attempt, baseMs, capMs);
				return Effect.sleep(Duration.millis(waitMs)).pipe(Effect.flatMap(() => loop(attempt + 1)));
			}),
		);

	return loop(0);
};
