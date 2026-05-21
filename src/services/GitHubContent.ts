import type { Effect } from "effect";
import { Context } from "effect";
import type { GitHubContentError } from "../errors/GitHubContentError.js";

/**
 * Service for reading repository file contents.
 *
 * @public
 */
export class GitHubContent extends Context.Tag("github-action-effects/GitHubContent")<
	GitHubContent,
	{
		/**
		 * Read a file's decoded UTF-8 contents at a ref.
		 *
		 * `ref` is optional; when omitted the repository's default branch is used.
		 * Fails with `GitHubContentError` when the path does not resolve to a file
		 * (missing, a directory, or a submodule).
		 */
		readonly getFile: (path: string, ref?: string) => Effect.Effect<string, GitHubContentError>;
	}
>() {}
