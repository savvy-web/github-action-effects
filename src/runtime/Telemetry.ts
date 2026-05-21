import { Metric } from "effect";

/**
 * Shared `Metric.counter` definitions for the library's observability surface.
 *
 * @remarks
 * These counters are incremented at the two highest-leverage funnels —
 * `GitHubClient.rest`/`graphql` and `CommandRunner` execution — plus the
 * rate-limiter's low-quota branches. They are inert by default: with no
 * metric reader provided (e.g. via `@effect/opentelemetry`), incrementing a
 * `Metric.counter` is a cheap no-op. Centralizing the definitions keeps the
 * metric names and descriptions consistent across call sites.
 *
 * Kept internal — these are an implementation detail, not part of the public
 * API. Tests import them via relative path; they are not re-exported from the
 * package barrel.
 *
 * @internal
 */
export const githubApiCalls = Metric.counter("github_action_effects_github_api_calls_total", {
	description: "Total GitHub API calls issued through GitHubClient",
});

/**
 * Count of rate-limit-triggered waits/failures.
 *
 * @internal
 */
export const rateLimitHits = Metric.counter("github_action_effects_rate_limit_hits_total", {
	description: "Times the rate limiter slept or failed because quota was low",
});

/**
 * Count of child-process executions through CommandRunner.
 *
 * @internal
 */
export const commandExecutions = Metric.counter("github_action_effects_command_executions_total", {
	description: "Total commands executed through CommandRunner",
});
