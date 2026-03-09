import { Schema } from "effect";

const TreeMode = Schema.Literal("100644", "100755", "040000");

/**
 * A tree entry that adds or updates a file.
 *
 * @public
 */
export const TreeEntryContent = Schema.Struct({
	path: Schema.String,
	mode: TreeMode,
	content: Schema.String,
}).annotations({ identifier: "TreeEntryContent" });

/**
 * A tree entry that deletes a file (sha: null).
 *
 * @public
 */
export const TreeEntryDeletion = Schema.Struct({
	path: Schema.String,
	mode: TreeMode,
	sha: Schema.Null,
}).annotations({ identifier: "TreeEntryDeletion" });

/**
 * A single entry in a Git tree object.
 * Either a content entry (add/update) or a deletion entry (sha: null).
 *
 * @public
 */
export const TreeEntry = Schema.Union(TreeEntryContent, TreeEntryDeletion).annotations({
	identifier: "TreeEntry",
});
export type TreeEntry = typeof TreeEntry.Type;

/**
 * A file change that adds or updates a file.
 *
 * @public
 */
export const FileChangeContent = Schema.Struct({
	path: Schema.String,
	content: Schema.String,
}).annotations({ identifier: "FileChangeContent" });

/**
 * A file change that deletes a file (sha: null).
 *
 * @public
 */
export const FileChangeDeletion = Schema.Struct({
	path: Schema.String,
	sha: Schema.Null,
}).annotations({ identifier: "FileChangeDeletion" });

/**
 * A file change for the commitFiles convenience method.
 * Either a content change (add/update) or a deletion (sha: null).
 *
 * @public
 */
export const FileChange = Schema.Union(FileChangeContent, FileChangeDeletion).annotations({
	identifier: "FileChange",
});
export type FileChange = typeof FileChange.Type;
