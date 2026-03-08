import { describe, expect, it } from "vitest";
import { GitHubOtelAttributes } from "./GitHubOtelAttributes.js";

describe("GitHubOtelAttributes", () => {
	it("maps environment variables to OTel attributes", () => {
		const env = {
			GITHUB_WORKFLOW: "CI",
			GITHUB_RUN_ID: "12345",
			GITHUB_RUN_NUMBER: "42",
			GITHUB_REF: "refs/heads/main",
			GITHUB_SHA: "abc123",
			GITHUB_ACTOR: "octocat",
			RUNNER_NAME: "runner-1",
			RUNNER_OS: "Linux",
			GITHUB_SERVER_URL: "https://github.com",
			GITHUB_REPOSITORY: "owner/repo",
		};
		const attrs = GitHubOtelAttributes.fromEnvironment(env);
		expect(attrs).toEqual({
			"cicd.pipeline.name": "CI",
			"cicd.pipeline.run.id": "12345",
			"cicd.pipeline.run.counter": "42",
			"vcs.ref.head.name": "refs/heads/main",
			"vcs.ref.head.revision": "abc123",
			"enduser.id": "octocat",
			"cicd.worker.name": "runner-1",
			"cicd.worker.os": "Linux",
			"vcs.repository.url.full": "https://github.com/owner/repo",
		});
	});

	it("omits missing environment variables", () => {
		const attrs = GitHubOtelAttributes.fromEnvironment({
			GITHUB_WORKFLOW: "CI",
		});
		expect(attrs).toEqual({ "cicd.pipeline.name": "CI" });
		expect(attrs).not.toHaveProperty("vcs.ref.head.name");
	});

	it("returns empty object when no env vars set", () => {
		const attrs = GitHubOtelAttributes.fromEnvironment({});
		expect(attrs).toEqual({});
	});

	it("skips empty string values", () => {
		const attrs = GitHubOtelAttributes.fromEnvironment({
			GITHUB_WORKFLOW: "",
		});
		expect(attrs).toEqual({});
	});

	it("composes repository URL from server + repository", () => {
		const attrs = GitHubOtelAttributes.fromEnvironment({
			GITHUB_SERVER_URL: "https://github.example.com",
			GITHUB_REPOSITORY: "org/project",
		});
		expect(attrs["vcs.repository.url.full"]).toBe("https://github.example.com/org/project");
	});
});
