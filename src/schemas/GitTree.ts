import { Schema } from "effect";

/**
 * A single entry in a Git tree object.
 *
 * @public
 */
export const TreeEntry = Schema.Struct({
	path: Schema.String,
	mode: Schema.Literal("100644", "100755", "040000"),
	content: Schema.String,
}).annotations({ identifier: "TreeEntry" });
export type TreeEntry = typeof TreeEntry.Type;

/**
 * A file change for the commitFiles convenience method.
 *
 * @public
 */
export const FileChange = Schema.Struct({
	path: Schema.String,
	content: Schema.String,
}).annotations({ identifier: "FileChange" });
export type FileChange = typeof FileChange.Type;
