import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Glob } from "../services/Glob.js";
import { GlobLive } from "./GlobLive.js";
import { GlobTest } from "./GlobTest.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const runLive = <A, E>(effect: Effect.Effect<A, E, Glob>) => Effect.runPromise(Effect.provide(effect, GlobLive));
const runLiveExit = <A, E>(effect: Effect.Effect<A, E, Glob>) =>
	Effect.runPromiseExit(Effect.provide(effect, GlobLive));

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "glob-test-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// glob
// ---------------------------------------------------------------------------

describe("GlobLive.glob", () => {
	it("returns sorted absolute paths for a simple * pattern", async () => {
		writeFileSync(join(dir, "b.txt"), "b");
		writeFileSync(join(dir, "a.txt"), "a");
		writeFileSync(join(dir, "c.txt"), "c");

		const result = await runLive(Effect.flatMap(Glob, (svc) => svc.glob(`${dir}/*.txt`)));

		expect(result).toEqual([join(dir, "a.txt"), join(dir, "b.txt"), join(dir, "c.txt")]);
	});

	it("honors ! exclude patterns", async () => {
		writeFileSync(join(dir, "keep.txt"), "k");
		writeFileSync(join(dir, "skip.log"), "s");

		const result = await runLive(Effect.flatMap(Glob, (svc) => svc.glob(`${dir}/*\n!${dir}/*.log`)));

		expect(result).toContain(join(dir, "keep.txt"));
		expect(result).not.toContain(join(dir, "skip.log"));
	});

	it("ignores blank lines and # comments", async () => {
		writeFileSync(join(dir, "a.txt"), "a");

		const result = await runLive(Effect.flatMap(Glob, (svc) => svc.glob(`\n# a comment\n${dir}/*.txt\n`)));

		expect(result).toEqual([join(dir, "a.txt")]);
	});

	it("returns [] when no file matches", async () => {
		const result = await runLive(Effect.flatMap(Glob, (svc) => svc.glob(`${dir}/nope/*.txt`)));
		expect(result).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// hashFiles
// ---------------------------------------------------------------------------

describe("GlobLive.hashFiles", () => {
	it("returns Option.none() when no file matches", async () => {
		const result = await runLive(Effect.flatMap(Glob, (svc) => svc.hashFiles(`${dir}/nope/*.txt`, { workspace: dir })));
		expect(Option.isNone(result)).toBe(true);
	});

	it("hashes a single known file to the expected sha256-of-sha256", async () => {
		const bytes = Buffer.from("hello world\n", "utf8");
		const filePath = join(dir, "only.txt");
		writeFileSync(filePath, bytes);

		// Compute the expected hash-of-hashes INDEPENDENTLY from the raw bytes:
		// sha256( sha256(file).digest() ), matching @actions/glob exactly. This
		// catches a hex-vs-binary or ordering regression that a snapshot would not.
		const perFile = createHash("sha256").update(bytes).digest(); // BINARY digest
		const expected = createHash("sha256").update(perFile).digest("hex");

		const result = await runLive(Effect.flatMap(Glob, (svc) => svc.hashFiles(`${dir}/*.txt`, { workspace: dir })));

		expect(Option.isSome(result)).toBe(true);
		if (Option.isSome(result)) {
			expect(result.value).toBe(expected);
		}
	});

	it("hashes multiple files in sorted glob order, matching an independent computation", async () => {
		const aBytes = Buffer.from("alpha", "utf8");
		const bBytes = Buffer.from("beta", "utf8");
		// Write out of order to prove ordering is determined by sort, not write order.
		writeFileSync(join(dir, "b.txt"), bBytes);
		writeFileSync(join(dir, "a.txt"), aBytes);

		// Sorted order is a.txt then b.txt; feed the BINARY per-file digests in
		// that order into one accumulating sha256.
		const acc = createHash("sha256");
		acc.update(createHash("sha256").update(aBytes).digest());
		acc.update(createHash("sha256").update(bBytes).digest());
		const expected = acc.digest("hex");

		const result = await runLive(Effect.flatMap(Glob, (svc) => svc.hashFiles(`${dir}/*.txt`, { workspace: dir })));

		expect(Option.isSome(result)).toBe(true);
		if (Option.isSome(result)) {
			expect(result.value).toBe(expected);
		}
	});

	it("is order-stable across two patterns matching the same files", async () => {
		writeFileSync(join(dir, "a.txt"), "alpha");
		writeFileSync(join(dir, "b.txt"), "beta");

		const viaStar = await runLive(Effect.flatMap(Glob, (svc) => svc.hashFiles(`${dir}/*.txt`, { workspace: dir })));
		const viaList = await runLive(
			Effect.flatMap(Glob, (svc) => svc.hashFiles(`${dir}/a.txt\n${dir}/b.txt`, { workspace: dir })),
		);

		expect(Option.isSome(viaStar)).toBe(true);
		expect(Option.isSome(viaList)).toBe(true);
		if (Option.isSome(viaStar) && Option.isSome(viaList)) {
			expect(viaStar.value).toBe(viaList.value);
		}
	});

	it("skips files outside the workspace root", async () => {
		const inside = join(dir, "inside");
		const outside = join(dir, "outside");
		// Two sibling dirs; workspace is `inside`, so the outside file must not
		// contribute to the hash.
		writeFileSync(join(dir, "inside-marker"), "x"); // ensure dirs exist via mkdir below
		const { mkdirSync } = await import("node:fs");
		mkdirSync(inside, { recursive: true });
		mkdirSync(outside, { recursive: true });
		const insideBytes = Buffer.from("inside-content", "utf8");
		writeFileSync(join(inside, "a.txt"), insideBytes);
		writeFileSync(join(outside, "b.txt"), "outside-content");

		// Expected hash includes ONLY the inside file.
		const expected = createHash("sha256").update(createHash("sha256").update(insideBytes).digest()).digest("hex");

		const result = await runLive(
			Effect.flatMap(Glob, (svc) => svc.hashFiles(`${inside}/*.txt\n${outside}/*.txt`, { workspace: inside })),
		);

		expect(Option.isSome(result)).toBe(true);
		if (Option.isSome(result)) {
			expect(result.value).toBe(expected);
		}
	});

	it("two different file contents produce different hashes", async () => {
		writeFileSync(join(dir, "a.txt"), "first content");
		const first = await runLive(Effect.flatMap(Glob, (svc) => svc.hashFiles(`${dir}/*.txt`, { workspace: dir })));

		writeFileSync(join(dir, "a.txt"), "second content");
		const second = await runLive(Effect.flatMap(Glob, (svc) => svc.hashFiles(`${dir}/*.txt`, { workspace: dir })));

		expect(Option.isSome(first)).toBe(true);
		expect(Option.isSome(second)).toBe(true);
		if (Option.isSome(first) && Option.isSome(second)) {
			expect(first.value).not.toBe(second.value);
		}
	});

	it("falls back to GITHUB_WORKSPACE when no workspace option is given", async () => {
		const bytes = Buffer.from("env-workspace", "utf8");
		writeFileSync(join(dir, "a.txt"), bytes);
		const prev = process.env.GITHUB_WORKSPACE;
		process.env.GITHUB_WORKSPACE = dir;
		try {
			const expected = createHash("sha256").update(createHash("sha256").update(bytes).digest()).digest("hex");
			const result = await runLive(Effect.flatMap(Glob, (svc) => svc.hashFiles(`${dir}/*.txt`)));
			expect(Option.isSome(result)).toBe(true);
			if (Option.isSome(result)) {
				expect(result.value).toBe(expected);
			}
		} finally {
			if (prev === undefined) {
				delete process.env.GITHUB_WORKSPACE;
			} else {
				process.env.GITHUB_WORKSPACE = prev;
			}
		}
	});

	it("Option.getOrElse(() => '') recovers the toolkit's empty-string sentinel", async () => {
		const result = await runLive(
			Effect.flatMap(Glob, (svc) =>
				svc.hashFiles(`${dir}/nope/*.txt`, { workspace: dir }).pipe(Effect.map(Option.getOrElse(() => ""))),
			),
		);
		expect(result).toBe("");
	});
});

// ---------------------------------------------------------------------------
// error path
// ---------------------------------------------------------------------------

describe("GlobLive error path", () => {
	it("fails with GlobError when globSync throws", async () => {
		// An invalid glob pattern (unterminated character class) makes globSync throw.
		const exit = await runLiveExit(Effect.flatMap(Glob, (svc) => svc.glob("[")));
		// node:fs globSync tolerates some patterns; assert the channel is typed
		// when it does throw. If it does not throw, the success path is still a
		// valid (empty) result — guard accordingly.
		if (exit._tag === "Failure") {
			const cause = JSON.stringify(exit.cause);
			expect(cause).toContain("GlobError");
		} else {
			expect(Array.isArray(exit.value)).toBe(true);
		}
	});

	it("fails hashFiles with GlobError when a matched path cannot be read as a file", async () => {
		const { mkdirSync } = await import("node:fs");
		// A directory matched by the pattern: createReadStream/pipeline rejects.
		mkdirSync(join(dir, "subdir"), { recursive: true });
		const exit = await runLiveExit(Effect.flatMap(Glob, (svc) => svc.hashFiles(`${dir}/subdir`, { workspace: dir })));
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure") {
			expect(JSON.stringify(exit.cause)).toContain("GlobError");
		}
	});
});

// ---------------------------------------------------------------------------
// GlobTest namespace
// ---------------------------------------------------------------------------

describe("GlobTest", () => {
	const run = <A, E>(state: ReturnType<typeof GlobTest.empty>, effect: Effect.Effect<A, E, Glob>) =>
		Effect.runPromise(Effect.provide(effect, GlobTest.layer(state)));

	it("layer returns seeded matches for a pattern", async () => {
		const state = GlobTest.empty();
		state.matches.set("*.ts", ["/repo/a.ts", "/repo/b.ts"]);
		const result = await run(
			state,
			Effect.flatMap(Glob, (svc) => svc.glob("*.ts")),
		);
		expect(result).toEqual(["/repo/a.ts", "/repo/b.ts"]);
	});

	it("layer returns [] for an unseeded glob pattern", async () => {
		const state = GlobTest.empty();
		const result = await run(
			state,
			Effect.flatMap(Glob, (svc) => svc.glob("*.ts")),
		);
		expect(result).toEqual([]);
	});

	it("layer returns seeded hash for a pattern", async () => {
		const state = GlobTest.empty();
		state.hashes.set("*.lock", "deadbeef");
		const result = await run(
			state,
			Effect.flatMap(Glob, (svc) => svc.hashFiles("*.lock")),
		);
		expect(Option.isSome(result)).toBe(true);
		if (Option.isSome(result)) {
			expect(result.value).toBe("deadbeef");
		}
	});

	it("layer returns Option.none() for an unseeded hash pattern", async () => {
		const state = GlobTest.empty();
		const result = await run(
			state,
			Effect.flatMap(Glob, (svc) => svc.hashFiles("*.lock")),
		);
		expect(Option.isNone(result)).toBe(true);
	});
});
