import type { Effect } from "effect";
import { Context } from "effect";
import type { GitCommitError } from "../errors/GitCommitError.js";
import type { FileChange, TreeEntry } from "../schemas/GitTree.js";

/**
 * Service interface for creating verified commits via Git Data API.
 *
 * @public
 */
export interface GitCommit {
	/** Create a tree object. Returns the tree SHA. */
	readonly createTree: (entries: Array<TreeEntry>, baseTree?: string) => Effect.Effect<string, GitCommitError>;

	/** Create a commit object. Returns the commit SHA. */
	readonly createCommit: (
		message: string,
		treeSha: string,
		parentShas: Array<string>,
	) => Effect.Effect<string, GitCommitError>;

	/** Update a ref to point at a new SHA. */
	readonly updateRef: (ref: string, sha: string, force?: boolean) => Effect.Effect<void, GitCommitError>;

	/** Convenience: commit files to a branch. Returns the commit SHA. */
	readonly commitFiles: (
		branch: string,
		message: string,
		files: Array<FileChange>,
	) => Effect.Effect<string, GitCommitError>;
}

/**
 * GitCommit tag for dependency injection.
 *
 * @public
 */
export const GitCommit = Context.GenericTag<GitCommit>("GitCommit");
