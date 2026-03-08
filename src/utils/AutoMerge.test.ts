import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { GitHubGraphQLTest } from "../layers/GitHubGraphQLTest.js";
import { AutoMerge } from "./AutoMerge.js";

describe("AutoMerge", () => {
	it("enables auto-merge with default SQUASH method", async () => {
		const { state, layer } = GitHubGraphQLTest.empty();
		state.mutationResponses.set("enableAutoMerge", { clientMutationId: null });

		await Effect.runPromise(AutoMerge.enable("PR_node123").pipe(Effect.provide(layer)));

		expect(state.mutationCalls).toHaveLength(1);
		expect(state.mutationCalls[0]?.operation).toBe("enableAutoMerge");
		expect(state.mutationCalls[0]?.variables?.mergeMethod).toBe("SQUASH");
	});

	it("enables auto-merge with specified merge method", async () => {
		const { state, layer } = GitHubGraphQLTest.empty();
		state.mutationResponses.set("enableAutoMerge", { clientMutationId: null });

		await Effect.runPromise(AutoMerge.enable("PR_node123", "REBASE").pipe(Effect.provide(layer)));

		expect(state.mutationCalls[0]?.variables?.mergeMethod).toBe("REBASE");
	});

	it("disables auto-merge", async () => {
		const { state, layer } = GitHubGraphQLTest.empty();
		state.mutationResponses.set("disableAutoMerge", { clientMutationId: null });

		await Effect.runPromise(AutoMerge.disable("PR_node456").pipe(Effect.provide(layer)));

		expect(state.mutationCalls).toHaveLength(1);
		expect(state.mutationCalls[0]?.operation).toBe("disableAutoMerge");
	});
});
