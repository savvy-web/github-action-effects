import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubContext, RunnerContext } from "./Environment.js";

describe("GitHubContext", () => {
	const valid = {
		sha: "abc123",
		ref: "refs/heads/main",
		repository: "owner/repo",
		repositoryOwner: "owner",
		workspace: "/home/runner/work/repo/repo",
		eventName: "push",
		eventPath: "/home/runner/work/_temp/event.json",
		runId: "12345",
		runNumber: "1",
		actor: "octocat",
		serverUrl: "https://github.com",
		apiUrl: "https://api.github.com",
		graphqlUrl: "https://api.github.com/graphql",
		action: "__run",
		job: "build",
		workflow: "CI",
	};

	it("decodes a valid context", () => {
		const result = Schema.decodeUnknownSync(GitHubContext)(valid);
		expect(result).toEqual(valid);
	});

	it("rejects missing fields", () => {
		expect(() => Schema.decodeUnknownSync(GitHubContext)({ sha: "abc" })).toThrow();
	});
});

describe("RunnerContext", () => {
	const valid = {
		os: "Linux",
		arch: "X64",
		name: "runner-1",
		temp: "/tmp",
		toolCache: "/opt/hostedtoolcache",
		debug: false,
	};

	it("decodes a valid runner context", () => {
		const result = Schema.decodeUnknownSync(RunnerContext)(valid);
		expect(result).toEqual(valid);
	});

	it("rejects invalid debug value", () => {
		expect(() => Schema.decodeUnknownSync(RunnerContext)({ ...valid, debug: "yes" })).toThrow();
	});
});
