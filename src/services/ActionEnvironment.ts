import type { FileSystem } from "@effect/platform";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { ActionEnvironmentError } from "../errors/ActionEnvironmentError.js";
import type { GitHubContext, RunnerContext } from "../schemas/Environment.js";
import type { WebhookPayload } from "../schemas/EventPayload.js";

/**
 * Service for reading GitHub Actions environment variables.
 *
 * @public
 */
export class ActionEnvironment extends Context.Tag("github-action-effects/ActionEnvironment")<
	ActionEnvironment,
	{
		/** Read a required environment variable. */
		readonly get: (name: string) => Effect.Effect<string, ActionEnvironmentError>;

		/** Read an optional environment variable. Returns Option.none() if not set. */
		readonly getOptional: (name: string) => Effect.Effect<Option.Option<string>>;

		/** Get the GitHub Actions context (GITHUB_* variables). Lazily validated. */
		readonly github: Effect.Effect<GitHubContext, ActionEnvironmentError>;

		/** Get the runner context (RUNNER_* variables). Lazily validated. */
		readonly runner: Effect.Effect<RunnerContext, ActionEnvironmentError>;

		/**
		 * True when `RUNNER_DEBUG === "1"`. Mirrors `@actions/core.isDebug()`.
		 */
		readonly isDebug: Effect.Effect<boolean>;

		/**
		 * Parsed `GITHUB_EVENT_PATH` payload, schema-decoded into a
		 * {@link WebhookPayload} (common fields typed, unknown keys preserved).
		 *
		 * @remarks
		 * Succeeds with an empty payload when `GITHUB_EVENT_PATH` is unset or the
		 * file is missing (matching `@actions/github`, which warns and uses `{}`).
		 * Fails {@link ActionEnvironmentError} only on malformed JSON.
		 */
		readonly payload: Effect.Effect<WebhookPayload, ActionEnvironmentError, FileSystem.FileSystem>;

		/**
		 * `{ owner, repo }` from `GITHUB_REPOSITORY`, else from
		 * `payload.repository`. Mirrors `@actions/github` `context.repo`. Fails
		 * {@link ActionEnvironmentError} when neither source is available.
		 */
		readonly repo: Effect.Effect<{ owner: string; repo: string }, ActionEnvironmentError, FileSystem.FileSystem>;

		/**
		 * `{ owner, repo, number }` where `number` is resolved from
		 * `issue ?? pull_request ?? payload` (top-level number). Mirrors
		 * `@actions/github` `context.issue`.
		 */
		readonly issue: Effect.Effect<
			{ owner: string; repo: string; number: number },
			ActionEnvironmentError,
			FileSystem.FileSystem
		>;
	}
>() {}
