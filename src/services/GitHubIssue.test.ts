import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubIssueTest } from "../layers/GitHubIssueTest.js";
import { GitHubIssue } from "./GitHubIssue.js";

describe("GitHubIssue", () => {
	it("lists all issues", async () => {
		const { state, layer } = GitHubIssueTest.empty();
		state.issues.set(1, { number: 1, title: "Bug", state: "open", labels: ["bug"] });
		state.issues.set(2, { number: 2, title: "Feature", state: "closed", labels: ["enhancement"] });

		const result = await Effect.runPromise(
			GitHubIssue.pipe(
				Effect.flatMap((svc) => svc.list()),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveLength(2);
	});

	it("filters by state", async () => {
		const { state, layer } = GitHubIssueTest.empty();
		state.issues.set(1, { number: 1, title: "Bug", state: "open", labels: [] });
		state.issues.set(2, { number: 2, title: "Feature", state: "closed", labels: [] });

		const result = await Effect.runPromise(
			GitHubIssue.pipe(
				Effect.flatMap((svc) => svc.list({ state: "open" })),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.state).toBe("open");
	});

	it("filters by labels", async () => {
		const { state, layer } = GitHubIssueTest.empty();
		state.issues.set(1, { number: 1, title: "Bug", state: "open", labels: ["bug"] });
		state.issues.set(2, { number: 2, title: "Feature", state: "open", labels: ["enhancement"] });
		state.issues.set(3, { number: 3, title: "Docs", state: "open", labels: ["docs"] });

		const result = await Effect.runPromise(
			GitHubIssue.pipe(
				Effect.flatMap((svc) => svc.list({ labels: ["bug", "docs"] })),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveLength(2);
	});

	it("closes an issue", async () => {
		const { state, layer } = GitHubIssueTest.empty();
		state.issues.set(1, { number: 1, title: "Bug", state: "open", labels: [] });

		await Effect.runPromise(
			GitHubIssue.pipe(
				Effect.flatMap((svc) => svc.close(1, "completed")),
				Effect.provide(layer),
			),
		);
		expect(state.closeCalls).toHaveLength(1);
		expect(state.closeCalls[0]).toEqual({ issueNumber: 1, reason: "completed" });
		expect(state.issues.get(1)?.state).toBe("closed");
	});

	it("fails to close unknown issue", async () => {
		const { layer } = GitHubIssueTest.empty();
		const exit = await Effect.runPromiseExit(
			GitHubIssue.pipe(
				Effect.flatMap((svc) => svc.close(999)),
				Effect.provide(layer),
			),
		);
		expect(Exit.isFailure(exit)).toBe(true);
	});

	it("adds a comment", async () => {
		const { state, layer } = GitHubIssueTest.empty();
		state.issues.set(1, { number: 1, title: "Bug", state: "open", labels: [] });

		const result = await Effect.runPromise(
			GitHubIssue.pipe(
				Effect.flatMap((svc) => svc.comment(1, "This is fixed")),
				Effect.provide(layer),
			),
		);
		expect(result.id).toBe(1001);
		expect(state.comments).toHaveLength(1);
		expect(state.comments[0]).toEqual({ issueNumber: 1, body: "This is fixed" });
	});

	it("gets linked issues for a PR", async () => {
		const { state, layer } = GitHubIssueTest.empty();
		state.linkedIssues.set(42, [
			{ number: 1, title: "Bug fix" },
			{ number: 2, title: "Feature" },
		]);

		const result = await Effect.runPromise(
			GitHubIssue.pipe(
				Effect.flatMap((svc) => svc.getLinkedIssues(42)),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveLength(2);
		expect(result[0]?.number).toBe(1);
	});

	it("returns empty for PR with no linked issues", async () => {
		const { layer } = GitHubIssueTest.empty();
		const result = await Effect.runPromise(
			GitHubIssue.pipe(
				Effect.flatMap((svc) => svc.getLinkedIssues(99)),
				Effect.provide(layer),
			),
		);
		expect(result).toHaveLength(0);
	});
});
