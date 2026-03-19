import { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";
import { ChangesetError } from "../errors/ChangesetError.js";
import type { BumpType, Changeset, ChangesetFile } from "../schemas/Changeset.js";
import { ChangesetAnalyzer } from "../services/ChangesetAnalyzer.js";

const DEFAULT_DIR = ".changeset";

const ADJECTIVES = [
	"brave",
	"calm",
	"dark",
	"eager",
	"fair",
	"gentle",
	"happy",
	"icy",
	"jolly",
	"keen",
	"lively",
	"merry",
	"neat",
	"odd",
	"proud",
	"quick",
	"rich",
	"shy",
	"tall",
	"wise",
];

const NOUNS = [
	"apple",
	"bear",
	"cloud",
	"deer",
	"eagle",
	"flame",
	"grape",
	"hawk",
	"iris",
	"jade",
	"kite",
	"lake",
	"moon",
	"nest",
	"oak",
	"pine",
	"quail",
	"rain",
	"star",
	"tree",
];

const randomElement = <T>(arr: ReadonlyArray<T>): T => arr[Math.floor(Math.random() * arr.length)];

const generateId = (): string => {
	const adj = randomElement(ADJECTIVES);
	const noun = randomElement(NOUNS);
	const num = Math.floor(Math.random() * 1000);
	return `${adj}-${noun}-${num}`;
};

const parseChangesetContent = (id: string, content: string): Effect.Effect<Changeset, ChangesetError> => {
	const parts = content.split("---");
	if (parts.length < 3) {
		return Effect.fail(
			new ChangesetError({
				operation: "parse",
				reason: `Invalid changeset format in ${id}: missing YAML frontmatter delimiters`,
			}),
		);
	}

	const frontmatter = parts[1].trim();
	const summary = parts.slice(2).join("---").trim();

	const packages: Array<{ name: string; bump: BumpType }> = [];
	for (const line of frontmatter.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;

		const match = trimmed.match(/^"([^"]+)":\s*(major|minor|patch)$/);
		if (!match) {
			return Effect.fail(
				new ChangesetError({
					operation: "parse",
					reason: `Invalid frontmatter line in ${id}: ${trimmed}`,
				}),
			);
		}
		packages.push({ name: match[1], bump: match[2] as BumpType });
	}

	return Effect.succeed({ id, packages, summary });
};

const generateContent = (packages: Array<{ name: string; bump: BumpType }>, summary: string): string => {
	const frontmatter = packages.map((p) => `"${p.name}": ${p.bump}`).join("\n");
	return `---\n${frontmatter}\n---\n\n${summary}\n`;
};

export const ChangesetAnalyzerLive: Layer.Layer<ChangesetAnalyzer, never, FileSystem.FileSystem> = Layer.effect(
	ChangesetAnalyzer,
	Effect.map(FileSystem.FileSystem, (fs) => {
		const listChangesetFiles = (dir: string): Effect.Effect<Array<string>, ChangesetError> =>
			fs.readDirectory(dir).pipe(
				Effect.map((entries) => entries.filter((e) => e.endsWith(".md") && e !== "README.md")),
				Effect.mapError(
					(error) =>
						new ChangesetError({
							operation: "read",
							reason: `Failed to read changeset directory ${dir}: ${error.message}`,
						}),
				),
			);

		return {
			parseAll: (dir?: string) => {
				const changesetDir = dir ?? DEFAULT_DIR;
				return listChangesetFiles(changesetDir).pipe(
					Effect.flatMap((files) =>
						Effect.all(
							files.map((file) => {
								const id = file.replace(/\.md$/, "");
								return fs.readFileString(`${changesetDir}/${file}`).pipe(
									Effect.mapError(
										(error) =>
											new ChangesetError({
												operation: "read",
												reason: `Failed to read changeset file ${file}: ${error.message}`,
											}),
									),
									Effect.flatMap((content) => parseChangesetContent(id, content)),
								);
							}),
						),
					),
				);
			},

			hasChangesets: (dir?: string) => {
				const changesetDir = dir ?? DEFAULT_DIR;
				return listChangesetFiles(changesetDir).pipe(
					Effect.map((files) => files.length > 0),
					Effect.catchAll(() => Effect.succeed(false)),
				);
			},

			generate: (packages, summary, dir?) => {
				const changesetDir = dir ?? DEFAULT_DIR;
				const id = generateId();
				const content = generateContent(packages, summary);
				const path = `${changesetDir}/${id}.md`;

				return fs.writeFileString(path, content).pipe(
					Effect.map((): ChangesetFile => ({ path, content })),
					Effect.mapError(
						(error) =>
							new ChangesetError({
								operation: "generate",
								reason: `Failed to write changeset file ${path}: ${error.message}`,
							}),
					),
				);
			},
		};
	}),
);
