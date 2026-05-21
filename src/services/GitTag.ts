import type { Effect } from "effect";
import { Context } from "effect";
import type { GitTagError } from "../errors/GitTagError.js";

/**
 * A tag name and the commit SHA it resolves to.
 *
 * @public
 */
export interface TagRef {
	readonly tag: string;
	/**
	 * The commit SHA the tag resolves to. Annotated tags are dereferenced,
	 * so this is always a commit SHA — never a raw tag-object SHA.
	 */
	readonly sha: string;
}

/**
 * Service for GitHub tag management via Git Data API.
 *
 * @public
 */
export class GitTag extends Context.Tag("github-action-effects/GitTag")<
	GitTag,
	{
		/** Create a lightweight tag pointing at the given SHA. */
		readonly create: (tag: string, sha: string) => Effect.Effect<void, GitTagError>;

		/** Delete a tag. */
		readonly delete: (tag: string) => Effect.Effect<void, GitTagError>;

		/** List tags, optionally filtered by prefix. */
		readonly list: (prefix?: string) => Effect.Effect<Array<TagRef>, GitTagError>;

		/** Resolve a tag to its commit SHA, dereferencing annotated tags. */
		readonly resolve: (tag: string) => Effect.Effect<string, GitTagError>;
	}
>() {}
