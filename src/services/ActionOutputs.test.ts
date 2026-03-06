import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ActionOutputsTest } from "../layers/ActionOutputsTest.js";
import { ActionOutputs } from "./ActionOutputs.js";

// -- Service method shorthand (eliminates repeated pipe+flatMap boilerplate) --

const use = <A, E>(fn: (svc: Effect.Effect.Success<typeof ActionOutputs>) => Effect.Effect<A, E>) =>
	Effect.flatMap(ActionOutputs, fn);

const runWithOutputs = <A, E>(effect: Effect.Effect<A, E, ActionOutputs>) => {
	const state = ActionOutputsTest.empty();
	return Effect.runPromise(Effect.provide(effect, ActionOutputsTest.layer(state))).then((result) => ({
		result,
		state,
	}));
};

describe("ActionOutputs", () => {
	describe("set", () => {
		it("captures a string output", async () => {
			const { state } = await runWithOutputs(use((svc) => svc.set("result", "success")));
			expect(state.outputs).toEqual([{ name: "result", value: "success" }]);
		});
	});

	describe("setJson", () => {
		const MySchema = Schema.Struct({
			count: Schema.Number,
			label: Schema.String,
		});

		it("serializes and captures JSON output", async () => {
			const { state } = await runWithOutputs(use((svc) => svc.setJson("data", { count: 42, label: "test" }, MySchema)));
			expect(state.outputs).toHaveLength(1);
			const first = state.outputs[0];
			expect(first).toBeDefined();
			expect(JSON.parse(first?.value ?? "")).toEqual({
				count: 42,
				label: "test",
			});
		});
	});

	describe("summary", () => {
		it("captures summary content", async () => {
			const { state } = await runWithOutputs(use((svc) => svc.summary("## Build Report\n\nAll good.")));
			expect(state.summaries).toEqual(["## Build Report\n\nAll good."]);
		});
	});

	describe("exportVariable", () => {
		it("captures exported variables", async () => {
			const { state } = await runWithOutputs(use((svc) => svc.exportVariable("MY_VAR", "value")));
			expect(state.variables).toEqual([{ name: "MY_VAR", value: "value" }]);
		});
	});

	describe("addPath", () => {
		it("captures added paths", async () => {
			const { state } = await runWithOutputs(use((svc) => svc.addPath("/usr/local/bin")));
			expect(state.paths).toEqual(["/usr/local/bin"]);
		});
	});
});
