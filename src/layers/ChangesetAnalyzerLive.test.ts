import { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { ChangesetAnalyzer } from "../services/ChangesetAnalyzer.js";
import { ChangesetAnalyzerLive } from "./ChangesetAnalyzerLive.js";

// -- Mock FileSystem --

interface MockFileEntry {
	readonly content: string;
}

const makeMockFs = (files: Record<string, MockFileEntry>): FileSystem.FileSystem => {
	const written: Record<string, string> = {};

	return {
		readDirectory: (path: string) =>
			Effect.sync(() => {
				const prefix = path.endsWith("/") ? path : `${path}/`;
				const entries = new Set<string>();
				for (const key of Object.keys(files)) {
					if (key.startsWith(prefix)) {
						const relative = key.slice(prefix.length);
						const firstSegment = relative.split("/")[0];
						entries.add(firstSegment);
					}
				}
				return [...entries];
			}),

		readFileString: (path: string) =>
			Effect.sync(() => {
				const entry = files[path];
				if (!entry) throw new Error(`File not found: ${path}`);
				return entry.content;
			}),

		writeFileString: (path: string, content: string) =>
			Effect.sync(() => {
				written[path] = content;
			}),

		// Stub all other methods to satisfy the interface
		access: () => Effect.void,
		chmod: () => Effect.void,
		chown: () => Effect.void,
		copy: () => Effect.void,
		copyFile: () => Effect.void,
		exists: () => Effect.succeed(true),
		link: () => Effect.void,
		makeDirectory: () => Effect.void,
		makeTempDirectory: () => Effect.succeed("/tmp/test"),
		makeTempDirectoryScoped: () => Effect.succeed("/tmp/test"),
		makeTempFile: () => Effect.succeed("/tmp/test-file"),
		makeTempFileScoped: () => Effect.succeed("/tmp/test-file"),
		open: () => Effect.die("not implemented"),
		readFile: () => Effect.die("not implemented"),
		readLink: () => Effect.succeed("/tmp"),
		realPath: () => Effect.succeed("/tmp"),
		remove: () => Effect.void,
		rename: () => Effect.void,
		sink: () => Effect.die("not implemented") as never,
		stat: () => Effect.die("not implemented"),
		stream: () => Effect.die("not implemented") as never,
		symlink: () => Effect.void,
		truncate: () => Effect.void,
		utimes: () => Effect.void,
		watch: () => Effect.die("not implemented") as never,
		writeFile: () => Effect.void,
	} as unknown as FileSystem.FileSystem;
};

const makeTestLayer = (files: Record<string, MockFileEntry>) =>
	Layer.provide(ChangesetAnalyzerLive, Layer.succeed(FileSystem.FileSystem, makeMockFs(files)));

const run = <A, E>(files: Record<string, MockFileEntry>, effect: Effect.Effect<A, E, ChangesetAnalyzer>) =>
	Effect.runPromise(Effect.provide(effect, makeTestLayer(files)));

const CHANGESET_CONTENT = `---
"@scope/package-a": minor
"@scope/package-b": patch
---

Summary text goes here.
`;

describe("ChangesetAnalyzerLive", () => {
	describe("parseAll", () => {
		it("reads and parses changeset files", async () => {
			const files = {
				".changeset/brave-cloud-42.md": { content: CHANGESET_CONTENT },
			};

			const result = await run(
				files,
				Effect.flatMap(ChangesetAnalyzer, (svc) => svc.parseAll()),
			);
			expect(result).toHaveLength(1);
			expect(result[0]).toMatchObject({
				id: "brave-cloud-42",
				packages: [
					{ name: "@scope/package-a", bump: "minor" },
					{ name: "@scope/package-b", bump: "patch" },
				],
				summary: "Summary text goes here.",
			});
		});

		it("skips README.md", async () => {
			const files = {
				".changeset/README.md": { content: "# Changesets\n\nHello" },
				".changeset/brave-cloud-42.md": { content: CHANGESET_CONTENT },
			};

			const result = await run(
				files,
				Effect.flatMap(ChangesetAnalyzer, (svc) => svc.parseAll()),
			);
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("brave-cloud-42");
		});

		it("handles empty directory", async () => {
			const files = {
				".changeset/README.md": { content: "# Changesets" },
			};

			const result = await run(
				files,
				Effect.flatMap(ChangesetAnalyzer, (svc) => svc.parseAll()),
			);
			expect(result).toHaveLength(0);
		});
	});

	describe("hasChangesets", () => {
		it("detects files", async () => {
			const files = {
				".changeset/brave-cloud-42.md": { content: CHANGESET_CONTENT },
			};

			const result = await run(
				files,
				Effect.flatMap(ChangesetAnalyzer, (svc) => svc.hasChangesets()),
			);
			expect(result).toBe(true);
		});

		it("returns false when only README.md exists", async () => {
			const files = {
				".changeset/README.md": { content: "# Changesets" },
			};

			const result = await run(
				files,
				Effect.flatMap(ChangesetAnalyzer, (svc) => svc.hasChangesets()),
			);
			expect(result).toBe(false);
		});
	});

	describe("generate", () => {
		it("creates valid changeset file", async () => {
			const files = {};

			const result = await run(
				files,
				Effect.flatMap(ChangesetAnalyzer, (svc) =>
					svc.generate(
						[
							{ name: "@scope/pkg-a", bump: "minor" },
							{ name: "@scope/pkg-b", bump: "patch" },
						],
						"Add new feature",
					),
				),
			);

			expect(result.path).toMatch(/^\.changeset\/.+\.md$/);
			expect(result.content).toContain('"@scope/pkg-a": minor');
			expect(result.content).toContain('"@scope/pkg-b": patch');
			expect(result.content).toContain("Add new feature");
			// Verify frontmatter structure
			expect(result.content).toMatch(/^---\n.*\n---\n\n/s);
		});
	});
});
