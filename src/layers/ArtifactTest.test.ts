import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import { Artifact } from "../services/Artifact.js";
import { ArtifactTest } from "./ArtifactTest.js";

const run = <A, E>(state: ReturnType<typeof ArtifactTest.empty>, effect: Effect.Effect<A, E, Artifact>) =>
	Effect.runPromise(Effect.provide(effect, ArtifactTest.layer(state)));

describe("ArtifactTest round-trip", () => {
	it("upload then list returns the uploaded artifact", async () => {
		const state = ArtifactTest.empty();
		const result = await run(
			state,
			Effect.gen(function* () {
				const svc = yield* Artifact;
				yield* svc.uploadArtifact("dist", ["a.txt", "b.txt"], "/work");
				return yield* svc.listArtifacts();
			}),
		);
		expect(result).toHaveLength(1);
		expect(result[0]?.name).toBe("dist");
		expect(result[0]?.size).toBe(2);
		expect(state.uploaded.get("dist")).toEqual(["a.txt", "b.txt"]);
	});

	it("upload then getArtifact(name) returns it; unknown name → none", async () => {
		const state = ArtifactTest.empty();
		const [hit, miss] = await run(
			state,
			Effect.gen(function* () {
				const svc = yield* Artifact;
				const { id } = yield* svc.uploadArtifact("dist", ["a.txt"], "/work");
				const found = yield* svc.getArtifact("dist");
				const notFound = yield* svc.getArtifact("nope");
				return [found, notFound, id] as const;
			}),
		);
		expect(Option.isSome(hit)).toBe(true);
		if (Option.isSome(hit)) expect(hit.value.name).toBe("dist");
		expect(Option.isNone(miss)).toBe(true);
	});

	it("assigns incrementing ids across uploads", async () => {
		const state = ArtifactTest.empty();
		const ids = await run(
			state,
			Effect.gen(function* () {
				const svc = yield* Artifact;
				const a = yield* svc.uploadArtifact("one", ["x"], "/work");
				const b = yield* svc.uploadArtifact("two", ["y"], "/work");
				return [a.id, b.id] as const;
			}),
		);
		expect(ids[0]).toBe(1);
		expect(ids[1]).toBe(2);
	});

	it("delete removes it from subsequent list", async () => {
		const state = ArtifactTest.empty();
		const [deleted, after] = await run(
			state,
			Effect.gen(function* () {
				const svc = yield* Artifact;
				const { id } = yield* svc.uploadArtifact("dist", ["a.txt"], "/work");
				const del = yield* svc.deleteArtifact("dist");
				const list = yield* svc.listArtifacts();
				return [del.id === id, list] as const;
			}),
		);
		expect(deleted).toBe(true);
		expect(after).toEqual([]);
	});

	it("deleteArtifact fails for an unknown name", async () => {
		const state = ArtifactTest.empty();
		const exit = await Effect.runPromise(
			Effect.exit(
				Effect.flatMap(Artifact, (svc) => svc.deleteArtifact("nope")).pipe(Effect.provide(ArtifactTest.layer(state))),
			),
		);
		expect(exit._tag).toBe("Failure");
	});

	it("downloadArtifact returns the requested path", async () => {
		const state = ArtifactTest.empty();
		const result = await run(
			state,
			Effect.flatMap(Artifact, (svc) => svc.downloadArtifact(7, { path: "/dest" })),
		);
		expect(result.downloadPath).toBe("/dest");
	});
});
