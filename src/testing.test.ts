import { describe, expect, it, vi } from "vitest";

// Make all @actions/* and @octokit/* imports throw
vi.mock("@actions/core", () => {
	throw new Error("@actions/core should not be imported by testing entry point");
});
vi.mock("@actions/cache", () => {
	throw new Error("@actions/cache should not be imported by testing entry point");
});
vi.mock("@actions/exec", () => {
	throw new Error("@actions/exec should not be imported by testing entry point");
});
vi.mock("@actions/github", () => {
	throw new Error("@actions/github should not be imported by testing entry point");
});
vi.mock("@actions/tool-cache", () => {
	throw new Error("@actions/tool-cache should not be imported by testing entry point");
});
vi.mock("@octokit/auth-app", () => {
	throw new Error("@octokit/auth-app should not be imported by testing entry point");
});

describe("testing entry point", () => {
	it("can be imported without @actions/* packages", async () => {
		const testingModule = await import("./testing.js");
		// Spot-check key exports
		expect(testingModule.ActionInputs).toBeDefined();
		expect(testingModule.ActionInputsTest).toBeDefined();
		expect(testingModule.ActionInputError).toBeDefined();
		expect(testingModule.ActionsCore).toBeDefined();
		expect(testingModule.InMemoryTracer).toBeDefined();
		expect(testingModule.GithubMarkdown).toBeDefined();
	});

	it("does not export wrapper Live layers", async () => {
		const testingModule = await import("./testing.js");
		expect(testingModule).not.toHaveProperty("ActionsCoreLive");
		expect(testingModule).not.toHaveProperty("ActionsGitHubLive");
		expect(testingModule).not.toHaveProperty("ActionsCacheLive");
		expect(testingModule).not.toHaveProperty("ActionsExecLive");
		expect(testingModule).not.toHaveProperty("ActionsToolCacheLive");
		expect(testingModule).not.toHaveProperty("OctokitAuthAppLive");
		expect(testingModule).not.toHaveProperty("ActionsPlatformLive");
	});
});
