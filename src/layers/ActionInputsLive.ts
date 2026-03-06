import * as core from "@actions/core";
import type { Schema } from "effect";
import { Effect, Layer, Option } from "effect";
import { ActionInputs } from "../services/ActionInputs.js";
import { decodeInput, decodeJsonInput } from "./internal/decodeInput.js";

export const ActionInputsLive: Layer.Layer<ActionInputs> = Layer.succeed(ActionInputs, {
	get: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = core.getInput(name, { required: true });
		return decodeInput(name, raw, schema);
	},

	getOptional: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = core.getInput(name, { required: false });
		if (raw === "") {
			return Effect.succeed(Option.none<A>());
		}
		return decodeInput(name, raw, schema).pipe(Effect.map((a) => Option.some(a)));
	},

	getSecret: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = core.getInput(name, { required: true });
		core.setSecret(raw);
		return decodeInput(name, raw, schema);
	},

	getJson: <A, I>(name: string, schema: Schema.Schema<A, I, never>) => {
		const raw = core.getInput(name, { required: true });
		return decodeJsonInput(name, raw, schema);
	},
});
