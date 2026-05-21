/**
 * Step-5 tests for the Sbom service.
 *
 * @remarks
 * Pure builder + serializer tests against `SbomLive`. The key edge case
 * — in-flight sibling packages overriding registry-derived versions —
 * is exercised explicitly so it doesn't regress.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileSystem } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Sbom, SbomLive } from "../testing.js";

const layer = Layer.merge(SbomLive, NodeFileSystem.layer);
const run = <A, E>(effect: Effect.Effect<A, E, Sbom | FileSystem.FileSystem>): Promise<A> =>
	Effect.runPromise(Effect.provide(effect, layer));

describe("Sbom service — step 5: CycloneDX BOM construction", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "attest-sbom-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	describe("generate + serializeJson", () => {
		it("produces a CycloneDX 1.5 BOM with the root component and dependencies", async () => {
			const json = await run(
				Effect.gen(function* () {
					const sbom = yield* Sbom;
					const bom = yield* sbom.generate({
						rootName: "@savvy-web/example",
						rootVersion: "1.0.0",
						rootLicense: "MIT",
						rootDescription: "Example package",
						dependencies: [
							{ name: "lodash", version: "4.17.21", license: "MIT" },
							{ name: "effect", version: "3.14.0" },
						],
					});
					return yield* sbom.serializeJson(bom);
				}),
			);

			const parsed = JSON.parse(json) as Record<string, unknown>;
			expect(parsed.bomFormat).toBe("CycloneDX");
			expect(parsed.specVersion).toBe("1.5");

			const meta = parsed.metadata as { component: { name: string; version: string } };
			expect(meta.component.name).toBe("@savvy-web/example");
			expect(meta.component.version).toBe("1.0.0");

			const components = parsed.components as Array<{ name: string; version: string; purl: string }>;
			expect(components).toHaveLength(2);
			expect(components.map((c) => c.name).sort()).toEqual(["effect", "lodash"]);
			expect(components.find((c) => c.name === "lodash")?.purl).toBe("pkg:npm/lodash@4.17.21");
		});

		it("overrides a dependency version when an in-flight sibling is provided", async () => {
			const json = await run(
				Effect.gen(function* () {
					const sbom = yield* Sbom;
					const bom = yield* sbom.generate({
						rootName: "@savvy-web/package-1",
						rootVersion: "1.0.1",
						dependencies: [
							// Registry-derived version of the sibling: stale, the
							// builder put 1.0.0 here but the in-flight version is
							// 1.0.0 as well — same name, different version takes
							// the in-flight value.
							{ name: "@savvy-web/package-2", version: "0.9.0" },
							{ name: "lodash", version: "4.17.21" },
						],
						inFlightPackages: [{ name: "@savvy-web/package-2", version: "1.0.0", license: "MIT" }],
					});
					return yield* sbom.serializeJson(bom);
				}),
			);

			const parsed = JSON.parse(json) as Record<string, unknown>;
			const components = parsed.components as Array<{
				name: string;
				version: string;
				purl: string;
				licenses?: Array<{ license: { name?: string; id?: string } }>;
			}>;

			const sibling = components.find((c) => c.name === "@savvy-web/package-2");
			expect(sibling).toBeDefined();
			expect(sibling?.version).toBe("1.0.0");
			expect(sibling?.purl).toBe("pkg:npm/%40savvy-web%2Fpackage-2@1.0.0");
		});

		it("adds in-flight packages that are not already in dependencies", async () => {
			const json = await run(
				Effect.gen(function* () {
					const sbom = yield* Sbom;
					const bom = yield* sbom.generate({
						rootName: "root",
						rootVersion: "1.0.0",
						dependencies: [{ name: "lodash", version: "4.17.21" }],
						inFlightPackages: [{ name: "@savvy-web/brand-new", version: "1.0.0" }],
					});
					return yield* sbom.serializeJson(bom);
				}),
			);
			const parsed = JSON.parse(json) as { components: Array<{ name: string }> };
			expect(parsed.components.map((c) => c.name).sort()).toEqual(["@savvy-web/brand-new", "lodash"]);
		});

		it("carries NTIA supplier and author metadata when provided", async () => {
			const before = Date.now();
			const json = await run(
				Effect.gen(function* () {
					const sbom = yield* Sbom;
					const bom = yield* sbom.generate({
						rootName: "@savvy-web/example",
						rootVersion: "1.0.0",
						supplier: {
							name: "Savvy Web Systems",
							url: ["https://savvyweb.systems"],
							contact: [{ name: "Release Bot", email: "release@savvyweb.systems" }],
						},
						authors: [{ name: "C. Spencer Beggs", email: "spencer@beggs.codes" }],
						dependencies: [],
					});

					// Assert on the in-memory BOM model directly.
					expect(bom.metadata.supplier?.name).toBe("Savvy Web Systems");
					expect(bom.metadata.timestamp).toBeInstanceOf(Date);
					const authorNames = Array.from(bom.metadata.authors).map((a) => a.name);
					expect(authorNames).toContain("C. Spencer Beggs");

					return yield* sbom.serializeJson(bom);
				}),
			);
			const after = Date.now();

			const parsed = JSON.parse(json) as {
				metadata: {
					timestamp: string;
					supplier?: { name?: string; url?: ReadonlyArray<string> };
					authors?: Array<{ name?: string; email?: string }>;
				};
			};

			expect(parsed.metadata.supplier?.name).toBe("Savvy Web Systems");
			expect(parsed.metadata.supplier?.url).toContain("https://savvyweb.systems");

			expect(parsed.metadata.authors).toBeDefined();
			const author = parsed.metadata.authors?.find((a) => a.name === "C. Spencer Beggs");
			expect(author).toBeDefined();
			expect(author?.email).toBe("spencer@beggs.codes");

			const ts = Date.parse(parsed.metadata.timestamp);
			expect(ts).toBeGreaterThanOrEqual(before);
			expect(ts).toBeLessThanOrEqual(after + 1000);
		});

		it("accepts a supplier with only a name (no url or contact)", async () => {
			const json = await run(
				Effect.gen(function* () {
					const sbom = yield* Sbom;
					const bom = yield* sbom.generate({
						rootName: "root",
						rootVersion: "1.0.0",
						supplier: { name: "Savvy Web Systems" },
						dependencies: [],
					});
					return yield* sbom.serializeJson(bom);
				}),
			);
			const parsed = JSON.parse(json) as {
				metadata: { supplier?: { name?: string; url?: unknown; contact?: unknown } };
			};
			expect(parsed.metadata.supplier?.name).toBe("Savvy Web Systems");
			expect(parsed.metadata.supplier?.url).toBeUndefined();
			expect(parsed.metadata.supplier?.contact).toBeUndefined();
		});

		it("omits supplier and authors metadata when not provided", async () => {
			const json = await run(
				Effect.gen(function* () {
					const sbom = yield* Sbom;
					const bom = yield* sbom.generate({
						rootName: "root",
						rootVersion: "1.0.0",
						dependencies: [],
					});
					return yield* sbom.serializeJson(bom);
				}),
			);
			const parsed = JSON.parse(json) as { metadata: Record<string, unknown> };
			expect(parsed.metadata.supplier).toBeUndefined();
			expect(parsed.metadata.authors).toBeUndefined();
		});

		it("includes a metadata timestamp", async () => {
			const before = Date.now();
			const json = await run(
				Effect.gen(function* () {
					const sbom = yield* Sbom;
					const bom = yield* sbom.generate({
						rootName: "root",
						rootVersion: "1.0.0",
						dependencies: [],
					});
					return yield* sbom.serializeJson(bom);
				}),
			);
			const after = Date.now();
			const parsed = JSON.parse(json) as { metadata: { timestamp: string } };
			const ts = Date.parse(parsed.metadata.timestamp);
			expect(ts).toBeGreaterThanOrEqual(before);
			expect(ts).toBeLessThanOrEqual(after + 1000);
		});
	});

	describe("save", () => {
		it("writes the serialized BOM to disk", async () => {
			const outPath = join(tmp, "sbom.json");
			await run(
				Effect.gen(function* () {
					const sbom = yield* Sbom;
					const bom = yield* sbom.generate({
						rootName: "root",
						rootVersion: "1.0.0",
						dependencies: [{ name: "lodash", version: "4.17.21" }],
					});
					yield* sbom.save(bom, outPath);
				}),
			);
			const onDisk = readFileSync(outPath, "utf-8");
			const parsed = JSON.parse(onDisk);
			expect(parsed.bomFormat).toBe("CycloneDX");
			expect(parsed.specVersion).toBe("1.5");
			expect(onDisk).toMatch(/^\{\n {2}/); // pretty-printed with 2-space indent
		});
	});
});
