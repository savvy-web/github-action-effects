import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { WebhookPayload } from "./EventPayload.js";

const decode = (input: unknown) => Schema.decodeUnknownSync(WebhookPayload)(input, { onExcessProperty: "preserve" });

describe("WebhookPayload", () => {
	it("decodes a pull_request payload", () => {
		const result = decode({
			pull_request: { number: 7, html_url: "https://x/pull/7" },
			repository: { name: "repo", owner: { login: "owner" } },
		});
		expect(result.pull_request?.number).toBe(7);
		expect(result.repository?.owner.login).toBe("owner");
	});

	it("decodes a pull_request with null body and null html_url", () => {
		const result = decode({
			pull_request: { number: 7, body: null, html_url: null },
		});
		expect(result.pull_request?.number).toBe(7);
		expect(result.pull_request?.body).toBeNull();
		expect(result.pull_request?.html_url).toBeNull();
	});

	it("decodes a repository with null full_name and null html_url", () => {
		const result = decode({
			repository: { name: "repo", full_name: null, html_url: null, owner: { login: "owner" } },
		});
		expect(result.repository?.name).toBe("repo");
		expect(result.repository?.full_name).toBeNull();
		expect(result.repository?.html_url).toBeNull();
	});

	it("decodes an issues payload", () => {
		const result = decode({ issue: { number: 12 } });
		expect(result.issue?.number).toBe(12);
	});

	it("decodes push refs", () => {
		const result = decode({ ref: "refs/heads/main", before: "aaa", after: "bbb" });
		expect(result.ref).toBe("refs/heads/main");
		expect(result.before).toBe("aaa");
		expect(result.after).toBe("bbb");
	});

	it("decodes a top-level number", () => {
		const result = decode({ number: 99 });
		expect(result.number).toBe(99);
	});

	it("preserves unknown keys", () => {
		const result = decode({ deployment: { id: 42 } }) as Record<string, unknown>;
		expect(result.deployment).toEqual({ id: 42 });
	});

	it("tolerates an empty payload", () => {
		const result = decode({});
		expect(result.issue).toBeUndefined();
		expect(result.pull_request).toBeUndefined();
		expect(result.repository).toBeUndefined();
	});

	it("decodes sender, action, comment", () => {
		const result = decode({ sender: { type: "User" }, action: "opened", comment: { id: 5 } });
		expect(result.sender?.type).toBe("User");
		expect(result.action).toBe("opened");
		expect(result.comment?.id).toBe(5);
	});

	it("fails on a non-object", () => {
		expect(() => decode("not an object")).toThrow();
	});
});
