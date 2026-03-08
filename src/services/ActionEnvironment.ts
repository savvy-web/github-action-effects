import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { ActionEnvironmentError } from "../errors/ActionEnvironmentError.js";
import type { GitHubContext, RunnerContext } from "../schemas/Environment.js";

/**
 * Service interface for reading GitHub Actions environment variables.
 *
 * @public
 */
export interface ActionEnvironment {
	/** Read a required environment variable. */
	readonly get: (name: string) => Effect.Effect<string, ActionEnvironmentError>;

	/** Read an optional environment variable. Returns Option.none() if not set. */
	readonly getOptional: (name: string) => Effect.Effect<Option.Option<string>>;

	/** Get the GitHub Actions context (GITHUB_* variables). Lazily validated. */
	readonly github: Effect.Effect<GitHubContext, ActionEnvironmentError>;

	/** Get the runner context (RUNNER_* variables). Lazily validated. */
	readonly runner: Effect.Effect<RunnerContext, ActionEnvironmentError>;
}

/**
 * ActionEnvironment tag for dependency injection.
 *
 * @public
 */
export const ActionEnvironment = Context.GenericTag<ActionEnvironment>("ActionEnvironment");
