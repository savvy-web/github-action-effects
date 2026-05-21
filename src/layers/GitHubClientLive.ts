import { Octokit } from "@octokit/rest";
import type { Redacted } from "effect";
import { Chunk, Effect, Layer, Option, Ref, Stream } from "effect";
import type { GitHubAppError } from "../errors/GitHubAppError.js";
import { GitHubClientError } from "../errors/GitHubClientError.js";
import * as WorkflowCommand from "../runtime/WorkflowCommand.js";
import { GitHubApp } from "../services/GitHubApp.js";
import { GitHubClient } from "../services/GitHubClient.js";
import type { RateLimitSnapshot } from "../services/RateLimitState.js";
import { RateLimitState } from "../services/RateLimitState.js";
import { unwrapRedacted } from "../utils/unwrapRedacted.js";
import { GitHubAppLive } from "./GitHubAppLive.js";
import { OctokitAuthAppLive } from "./OctokitAuthAppLive.js";
import type { ResilienceOptions } from "./resilience.js";
import { withResilience } from "./resilience.js";

// Re-export the pure resilience surface so consumers can reach it through the
// GitHubClient layer module (it lives in the octokit-free `resilience.ts` so
// the testing entry point can also export it without dragging in @octokit/rest).
export type { ResilienceOptions } from "./resilience.js";
export { resilienceSchedule } from "./resilience.js";

/**
 * Custom `log` sink installed on every Octokit instance to suppress the
 * `@octokit/plugin-request-log` per-request lines that would otherwise
 * leak past `Step.withStep`'s buffer.
 *
 * The plugin is enabled by default in `@octokit/rest`. Its wrap-hook
 * calls `octokit.log.info(...)` after every successful request and
 * `octokit.log.error(...)` on failure — the latter producing lines
 * like `POST /repos/owner/name/git/refs - 422 with id ... in 412ms`
 * that we see in the runner UI even after the orchestrator has caught
 * the error and recovered (idempotent recovery, `getReleaseByTag`
 * fallback, etc).
 *
 * Routing through `WorkflowCommand.issue("debug", …)` emits a
 * `::debug::` workflow command — visible only when the workflow
 * exports `ACTIONS_STEP_DEBUG=true`. The full error context the user
 * needs on a real failure is already carried by the `GitHubClientError`
 * that `wrapError` constructs and surfaces through Effect's error
 * channel.
 */
const silentOctokitLog = {
	debug: (message: string): void => {
		WorkflowCommand.issue("debug", {}, message);
	},
	info: (message: string): void => {
		WorkflowCommand.issue("debug", {}, message);
	},
	warn: (message: string): void => {
		WorkflowCommand.issue("debug", {}, message);
	},
	error: (message: string): void => {
		WorkflowCommand.issue("debug", {}, message);
	},
};

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

/**
 * Structural shape of the response headers Octokit returns at runtime. The
 * callback types name only `{ data }`, but Octokit hands back the full
 * `OctokitResponse` (`{ data, headers, status, url }`); the resilient client
 * reads `headers` via this cast at the wire boundary. A hand-rolled `fn` that
 * genuinely returns only `{ data }` yields no headers and degrades safely.
 */
interface WithHeaders {
	readonly headers?: Record<string, string | number | undefined>;
}

const headerValue = (
	headers: Record<string, string | number | undefined> | undefined,
	key: string,
): string | undefined => {
	const raw = headers?.[key];
	return raw === undefined ? undefined : String(raw);
};

/** Parse a server-advised retry delay (ms) from an Octokit-shaped error, if any. */
const parseRetryAfterMs = (error: unknown): number | undefined => {
	const headers =
		typeof error === "object" && error !== null && "response" in error
			? (error as { response?: { headers?: Record<string, string | number | undefined> } }).response?.headers
			: undefined;
	if (!headers) return undefined;

	const retryAfter = headerValue(headers, "retry-after");
	if (retryAfter !== undefined) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds) && seconds >= 0) {
			return Math.round(seconds * 1000);
		}
	}

	const remaining = headerValue(headers, "x-ratelimit-remaining");
	const reset = headerValue(headers, "x-ratelimit-reset");
	if (remaining === "0" && reset !== undefined) {
		const resetEpoch = Number(reset);
		if (Number.isFinite(resetEpoch)) {
			const waitMs = resetEpoch * 1000 - Date.now();
			return waitMs > 0 ? waitMs : 0;
		}
	}

	return undefined;
};

const wrapError = (operation: string, error: unknown): GitHubClientError => {
	const status =
		typeof error === "object" && error !== null && "status" in error ? (error as { status: number }).status : undefined;
	let message = error instanceof Error ? error.message : String(error);

	// Detect HTML error responses (GitHub "Unicorn" pages) and replace with clean message
	if (message.includes("<!DOCTYPE") || message.includes("<html")) {
		message =
			status !== undefined ? `GitHub API returned ${status} (server error)` : "GitHub API returned an HTML error page";
	}

	return new GitHubClientError({
		operation,
		status,
		reason: message,
		retryable: status !== undefined && isRetryableStatus(status),
		retryAfterMs: parseRetryAfterMs(error),
	});
};

/** Parse a rate-limit snapshot from a successful response's headers, if present. */
const parseSnapshot = (response: WithHeaders): Option.Option<RateLimitSnapshot> => {
	const headers = response.headers;
	const remaining = headerValue(headers, "x-ratelimit-remaining");
	const limit = headerValue(headers, "x-ratelimit-limit");
	const reset = headerValue(headers, "x-ratelimit-reset");
	if (remaining === undefined || limit === undefined || reset === undefined) {
		return Option.none();
	}
	const remainingNum = Number(remaining);
	const limitNum = Number(limit);
	const resetNum = Number(reset);
	if (!Number.isFinite(remainingNum) || !Number.isFinite(limitNum) || !Number.isFinite(resetNum)) {
		return Option.none();
	}
	return Option.some({
		remaining: remainingNum,
		limit: limitNum,
		resetEpochSeconds: resetNum,
		observedAt: Date.now(),
	});
};

/**
 * Build the GitHubClient service object from a concrete token.
 *
 * `snapshotRef` is the shared rate-limit state the client writes observed
 * `x-ratelimit-*` headers into. `resilience` tunes (or disables) the automatic
 * retry/backoff applied to every call.
 */
const makeClient = (
	token: string,
	snapshotRef: Ref.Ref<Option.Option<RateLimitSnapshot>>,
	resilience?: ResilienceOptions,
): typeof GitHubClient.Service => {
	const octokit = new Octokit({ auth: token, log: silentOctokitLog });

	/** Record a successful response's rate-limit headers into the shared snapshot. */
	const recordSnapshot = (response: WithHeaders): Effect.Effect<void> => {
		const parsed = parseSnapshot(response);
		return Option.isSome(parsed) ? Ref.set(snapshotRef, parsed) : Effect.void;
	};

	return {
		rest: <T>(operation: string, fn: (octokit: unknown) => Promise<{ data: T }>) =>
			withResilience(
				Effect.tryPromise({
					try: () => fn(octokit),
					catch: (error) => wrapError(operation, error),
				}),
				resilience,
			).pipe(
				Effect.tap((response) => recordSnapshot(response as WithHeaders)),
				Effect.map((response) => response.data),
			),

		paginate: <T>(
			operation: string,
			fn: (octokit: unknown, page: number, perPage: number) => Promise<{ data: T[] }>,
			options?: { perPage?: number; maxPages?: number },
		) => {
			const perPage = options?.perPage ?? 100;
			const maxPages = options?.maxPages ?? Infinity;

			const loop = (page: number, accumulated: Array<T>): Effect.Effect<Array<T>, GitHubClientError> =>
				withResilience(
					Effect.tryPromise({
						try: () => fn(octokit, page, perPage),
						catch: (error) => wrapError(operation, error),
					}),
					resilience,
				).pipe(
					Effect.tap((response) => recordSnapshot(response as WithHeaders)),
					Effect.flatMap((response) => {
						const results = [...accumulated, ...response.data];
						if (response.data.length < perPage || page >= maxPages) {
							return Effect.succeed(results);
						}
						return loop(page + 1, results);
					}),
				);

			return loop(1, []);
		},

		paginateStream: <T>(
			operation: string,
			fn: (octokit: unknown, page: number, perPage: number) => Promise<{ data: T[] }>,
			options?: { perPage?: number; maxPages?: number },
		) => {
			const perPage = options?.perPage ?? 100;
			const maxPages = options?.maxPages ?? Infinity;

			return Stream.paginateChunkEffect(1, (page: number) =>
				withResilience(
					Effect.tryPromise({
						try: () => fn(octokit, page, perPage),
						catch: (error) => wrapError(operation, error),
					}),
					resilience,
				).pipe(
					Effect.tap((response) => recordSnapshot(response as WithHeaders)),
					Effect.map((response) => {
						const chunk = Chunk.fromIterable(response.data);
						const more = response.data.length >= perPage && page < maxPages;
						return [chunk, more ? Option.some(page + 1) : Option.none<number>()] as const;
					}),
				),
			);
		},

		graphql: <T>(query: string, variables: Record<string, unknown> = {}) =>
			withResilience(
				Effect.tryPromise({
					try: () => octokit.graphql<T>(query, variables),
					catch: (error) => wrapError("graphql", error),
				}),
				resilience,
			),

		repo: Effect.try({
			try: () => {
				const repository = process.env.GITHUB_REPOSITORY;
				if (!repository) {
					throw new Error("GITHUB_REPOSITORY not set");
				}
				const parts = repository.split("/");
				const owner = parts[0] ?? "";
				const repo = parts[1] ?? "";
				return { owner, repo };
			},
			catch: (error) =>
				new GitHubClientError({
					operation: "repo",
					status: undefined,
					reason: error instanceof Error ? error.message : String(error),
					retryable: false,
					retryAfterMs: undefined,
				}),
		}),
	};
};

/**
 * Resolve the shared rate-limit snapshot `Ref`. Uses the app-provided
 * `RateLimitState` when present (so `RateLimiterLive` reads the same headers
 * the client writes); otherwise falls back to a private throwaway `Ref` so the
 * client stays self-contained and the requirement never leaks into the build
 * graph or any consumer.
 */
const resolveSnapshotRef: Effect.Effect<Ref.Ref<Option.Option<RateLimitSnapshot>>> = Effect.flatMap(
	Effect.serviceOption(RateLimitState),
	(maybe) => (Option.isSome(maybe) ? Effect.succeed(maybe.value) : Ref.make(Option.none<RateLimitSnapshot>())),
);

/**
 * Reads the ambient `process.env.GITHUB_TOKEN` — the weak repo-scoped default
 * token. NOT the path for permission-sensitive work; use `fromToken` or `fromApp`
 * with an explicitly constructed identity instead.
 *
 * Resilient by default; pass `resilience` to tune or disable retries.
 */
const fromEnv = (resilience?: ResilienceOptions): Layer.Layer<GitHubClient, GitHubClientError> =>
	Layer.effect(
		GitHubClient,
		Effect.gen(function* () {
			const snapshotRef = yield* resolveSnapshotRef;
			const token = process.env.GITHUB_TOKEN;
			if (!token) {
				return yield* Effect.fail(wrapError("getOctokit", new Error("GITHUB_TOKEN not set")));
			}
			return makeClient(token, snapshotRef, resilience);
		}),
	);

/**
 * Build a client from an explicit token. No `process.env` dependency.
 *
 * Resilient by default; pass `resilience` to tune or disable retries.
 */
const fromToken = (
	token: string | Redacted.Redacted<string>,
	resilience?: ResilienceOptions,
): Layer.Layer<GitHubClient> =>
	Layer.effect(
		GitHubClient,
		Effect.map(resolveSnapshotRef, (snapshotRef) => makeClient(unwrapRedacted(token), snapshotRef, resilience)),
	);

/**
 * Generate a GitHub App installation token from App credentials, then build the
 * client. Composes `OctokitAuthAppLive` + `GitHubAppLive` internally.
 *
 * Builds as a scoped layer: the minted installation token is revoked on scope
 * close (best-effort `DELETE /installation/token`). Consumers on
 * `ActionsRuntime.Default` / `Action.run` (which wrap in `Effect.scoped`) are
 * unaffected; a consumer providing this via a bare `Effect.provide` must wrap in
 * `Effect.scoped` to satisfy the build-time `Scope` requirement.
 *
 * Resilient by default; pass `resilience` to tune or disable retries.
 *
 * @example
 * ```ts
 * import { Effect, Layer } from "effect"
 * import { GitHubClient, GitHubClientLive } from "@savvy-web/github-action-effects"
 *
 * // Share one App client (and one installation token) across multiple provides
 * // in a single run by memoizing the layer; it builds at most once.
 * const program = Effect.gen(function* () {
 *   const shared = yield* Layer.memoize(
 *     GitHubClientLive.fromApp({ clientId, privateKey, installationId }),
 *   )
 *   yield* subProgramA.pipe(Effect.provide(shared))
 *   yield* subProgramB.pipe(Effect.provide(shared))
 * }).pipe(Effect.scoped)
 * ```
 */
const fromApp = (
	options: {
		clientId: string;
		privateKey: string | Redacted.Redacted<string>;
		installationId?: number;
	},
	resilience?: ResilienceOptions,
): Layer.Layer<GitHubClient, GitHubAppError> =>
	Layer.scoped(
		GitHubClient,
		Effect.gen(function* () {
			const app = yield* GitHubApp;
			const snapshotRef = yield* resolveSnapshotRef;
			const installationToken = yield* Effect.acquireRelease(
				app.generateToken(options.clientId, unwrapRedacted(options.privateKey), options.installationId),
				// Best-effort revoke on scope close; ignore failures (token expires anyway).
				(token) => app.revokeToken(token.token).pipe(Effect.ignore),
			);
			return makeClient(installationToken.token, snapshotRef, resilience);
		}),
	).pipe(Layer.provide(GitHubAppLive), Layer.provide(OctokitAuthAppLive));

/**
 * Live `GitHubClient` layer constructors.
 *
 * @public
 */
export const GitHubClientLive = {
	fromEnv,
	fromToken,
	fromApp,
} as const;
