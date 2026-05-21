import type { HttpClient } from "@effect/platform";
import { HttpClientRequest, HttpClientResponse } from "@effect/platform";
import { Effect, Redacted, Schedule, Schema } from "effect";

/**
 * Shared Twirp RPC plumbing for the GitHub Actions results backend.
 *
 * @remarks
 * The cache (`ActionCacheLive`) and artifact (`ArtifactLive`) services both
 * speak Twirp over HTTP to the same `ACTIONS_RESULTS_URL` backend, differing
 * only in the service segment of the path
 * (`github.actions.results.api.v1.CacheService` vs `…ArtifactService`). This
 * module extracts the `twirpCall` helper, the `CONFLICT` sentinel, and the
 * retry schedule so both layers share one source of truth.
 *
 * It is generic over the error channel `E` so each caller maps transport /
 * HTTP failures into its own `Data.TaggedError`. The error `reason` strings are
 * preserved verbatim (`<method> failed: HTTP <status> from <method>` and
 * `<method> failed: <transport message>`) so the retry schedule's
 * `reason.includes("HTTP 503")` / `reason.includes("ECONNRESET")` predicates
 * keep firing and existing `ActionCacheLive` assertions stay valid.
 *
 * @internal
 */

/**
 * Sentinel returned by {@link twirpCall} when the server responds with HTTP 409
 * (Conflict), indicating the resource already exists. Callers may treat this as
 * a success.
 *
 * @internal
 */
export const CONFLICT = Symbol.for("twirp/conflict");

/** Result of a Twirp call: the decoded body, or the {@link CONFLICT} sentinel. */
export type TwirpResult<T> = T | typeof CONFLICT;

/**
 * Make a Twirp RPC call (POST with a JSON body/response) against
 * `<baseUrl>twirp/<service>/<method>`.
 *
 * Returns {@link CONFLICT} on HTTP 409 instead of failing. Maps transport faults
 * and non-2xx statuses into `E` via `onError`, preserving the substrings the
 * retry schedule keys off.
 *
 * @internal
 */
export const twirpCall = <T, E>(
	http: HttpClient.HttpClient,
	baseUrl: string,
	service: string,
	token: Redacted.Redacted<string>,
	method: string,
	body: Record<string, unknown>,
	onError: (reason: string) => E,
): Effect.Effect<TwirpResult<T>, E> =>
	Effect.gen(function* () {
		const request = HttpClientRequest.post(`${baseUrl}twirp/${service}/${method}`).pipe(
			// Unwrap the runtime token only here, at the request boundary (S9).
			HttpClientRequest.bearerToken(Redacted.value(token)),
			HttpClientRequest.bodyUnsafeJson(body),
		);
		// Transport faults surface as `<method> failed: <message>`; the message
		// preserves the underlying `ECONNRESET`/`ETIMEDOUT` substring the retry
		// schedule keys off.
		const response = yield* http
			.execute(request)
			.pipe(Effect.mapError((cause) => onError(`${method} failed: ${cause.message}`)));
		if (response.status === 409) {
			return CONFLICT;
		}
		if (response.status < 200 || response.status >= 300) {
			// Preserve the exact reason the raw-`fetch` implementation produced
			// (`<method> failed: HTTP <status> from <method>`): the leading
			// `<method> failed` keeps existing assertions valid and the embedded
			// `HTTP <status>` keeps the retry schedule's `reason.includes("HTTP
			// 503")` predicate firing.
			return yield* Effect.fail(onError(`${method} failed: HTTP ${response.status} from ${method}`));
		}
		return (yield* HttpClientResponse.schemaBodyJson(Schema.Unknown)(response).pipe(
			Effect.mapError((cause) => onError(`${method} failed: ${cause.message ?? String(cause)}`)),
		)) as T;
	});

/**
 * Reason substrings that mark a Twirp failure as retryable (transient 5xx and
 * network faults).
 *
 * @internal
 */
const RETRYABLE_REASONS = [
	"HTTP 500",
	"HTTP 502",
	"HTTP 503",
	"HTTP 504",
	"ECONNRESET",
	"ECONNREFUSED",
	"ETIMEDOUT",
] as const;

/**
 * Whether a failure `reason` string marks a transient/retryable Twirp fault.
 *
 * @internal
 */
export const isRetryableTwirpReason = (reason: string): boolean =>
	RETRYABLE_REASONS.some((needle) => reason.includes(needle));

/**
 * Build the shared Twirp retry schedule (exponential backoff capped at 4
 * retries) gated on the caller's error `reason` string.
 *
 * @internal
 */
export const makeTwirpRetrySchedule = <E>(reasonOf: (error: E) => string): Schedule.Schedule<unknown, E> =>
	Schedule.intersect(Schedule.exponential("3 seconds", 1.5), Schedule.recurs(4)).pipe(
		Schedule.whileInput((error: E) => isRetryableTwirpReason(reasonOf(error))),
	);
