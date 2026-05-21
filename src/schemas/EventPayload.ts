import { Schema } from "effect";

/**
 * The `repository` object on a webhook payload (typed subset).
 *
 * @internal
 */
const Repository = Schema.Struct({
	name: Schema.String,
	full_name: Schema.optional(Schema.String),
	owner: Schema.Struct({ login: Schema.String }),
	html_url: Schema.optional(Schema.String),
});

/**
 * An issue / pull-request reference on a webhook payload (typed subset).
 *
 * @internal
 */
const IssueRef = Schema.Struct({
	number: Schema.Number,
	html_url: Schema.optional(Schema.String),
	body: Schema.optional(Schema.String),
});

/**
 * Common GitHub webhook event payload fields.
 *
 * @remarks
 * Mirrors the typed subset of `@actions/github` `WebhookPayload`. Every field
 * is optional, and the struct is intended to be decoded with
 * `{ onExcessProperty: "preserve" }` so unknown keys (the bulk of any real
 * webhook body) survive — matching the toolkit's `[key: string]: any` index
 * signature. Decoding a non-object value fails.
 *
 * @public
 */
export const WebhookPayload = Schema.Struct({
	repository: Schema.optional(Repository),
	issue: Schema.optional(IssueRef),
	pull_request: Schema.optional(IssueRef),
	sender: Schema.optional(Schema.Struct({ type: Schema.String })),
	action: Schema.optional(Schema.String),
	comment: Schema.optional(Schema.Struct({ id: Schema.Number })),
	installation: Schema.optional(Schema.Struct({ id: Schema.Number })),
	/** Top-level number (some events carry the issue/PR number at the root). */
	number: Schema.optional(Schema.Number),
	// Push event fields (not in @actions/github's WebhookPayload interface, but
	// present on the open payload for push events).
	ref: Schema.optional(Schema.String),
	before: Schema.optional(Schema.String),
	after: Schema.optional(Schema.String),
}).annotations({ identifier: "WebhookPayload" });

/** Inferred type for {@link WebhookPayload}. */
export type WebhookPayload = typeof WebhookPayload.Type;
