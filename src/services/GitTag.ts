import type { Effect } from "effect";
import { Context } from "effect";
import type { GitTagError } from "../errors/GitTagError.js";

/**
 * A tag name and the SHA it points to.
 *
 * @public
 */
export interface TagRef {
	readonly tag: string;
	readonly sha: string;
}

/**
 * Service interface for GitHub tag management via Git Data API.
 *
 * @public
 */
export interface GitTag {
	/** Create a lightweight tag pointing at the given SHA. */
	readonly create: (tag: string, sha: string) => Effect.Effect<void, GitTagError>;

	/** Delete a tag. */
	readonly delete: (tag: string) => Effect.Effect<void, GitTagError>;

	/** List tags, optionally filtered by prefix. */
	readonly list: (prefix?: string) => Effect.Effect<Array<TagRef>, GitTagError>;

	/** Resolve a tag to its SHA. */
	readonly resolve: (tag: string) => Effect.Effect<string, GitTagError>;
}

/**
 * GitTag tag for dependency injection.
 *
 * @public
 */
export const GitTag = Context.GenericTag<GitTag>("GitTag");
