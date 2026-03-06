import { Schema } from "effect";

/**
 * Status values for {@link statusIcon}.
 */
export const Status = Schema.Literal("pass", "fail", "skip", "warn").annotations({
	identifier: "Status",
	title: "Check Status",
	description: "Status indicator for check run outcomes",
});

export type Status = typeof Status.Type;

/**
 * A single item in a checklist.
 */
export const ChecklistItem = Schema.Struct({
	label: Schema.String,
	checked: Schema.Boolean,
}).annotations({
	identifier: "ChecklistItem",
	title: "Checklist Item",
});

export type ChecklistItem = typeof ChecklistItem.Type;

/**
 * A captured output entry.
 */
export const CapturedOutput = Schema.Struct({
	name: Schema.String,
	value: Schema.String,
}).annotations({
	identifier: "CapturedOutput",
	title: "Captured Output",
});

export type CapturedOutput = typeof CapturedOutput.Type;
