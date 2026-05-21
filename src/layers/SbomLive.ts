/**
 * SBOM service — produces a CycloneDX 1.5 BOM from a post-relink
 * dependency graph.
 *
 * @remarks
 * Uses `@cyclonedx/cyclonedx-library` directly rather than shelling out
 * to `cdxgen` for two reasons:
 *
 * 1. The action bundle already vendors the library; spawning a CLI just
 *    to serialize JSON we could produce in-process is wasted I/O.
 * 2. The library lets us hand-build the BOM from a structured input,
 *    which is the only way to handle the unpublished-sibling case (a
 *    package being released that depends on a sibling being released in
 *    the same wave — the sibling won't be on the registry yet, so any
 *    registry-based resolver would fall down).
 *
 * Callers supply the resolved dependency map themselves (the builder
 * has already parsed `package.json` and relinked workspace references),
 * and may pass `inFlightPackages` to flag siblings being released
 * alongside the root. This service is pure aside from the file save —
 * no network, no subprocesses.
 */

import type * as CdxLibrary from "@cyclonedx/cyclonedx-library";
import { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";
import { SbomError } from "../errors/SbomError.js";
import type {
	CycloneDXBom,
	InFlightPackage,
	ResolvedDependency,
	SbomAuthor,
	SbomInput,
	SbomSupplier,
} from "../services/Sbom.js";
import { Sbom } from "../services/Sbom.js";

/**
 * Lazy module cache for `@cyclonedx/cyclonedx-library`.
 *
 * @remarks
 * The library statically imports several optional plugins
 * (`ajv-formats-draft2019`, `xmlbuilder2`, `libxmljs2`) which we
 * externalize in the bundler config; rspack emits those as top-level
 * ESM `import * as ...` statements that fail at Node's resolution
 * phase when the modules aren't installed. By deferring the entire
 * `@cyclonedx/cyclonedx-library` import to inside the service methods,
 * the chain only runs when a caller actually invokes `Sbom.generate`
 * — provenance-only attestation paths never pay the cost.
 */
let cdxCache: typeof CdxLibrary | undefined;
const loadCdx = async (): Promise<typeof CdxLibrary> => {
	if (!cdxCache) cdxCache = await import("@cyclonedx/cyclonedx-library");
	return cdxCache;
};

const npmPurl = (name: string, version: string): string => `pkg:npm/${encodeURIComponent(name)}@${version}`;

const makeComponent = (
	cdx: typeof CdxLibrary,
	type: CdxLibrary.Enums.ComponentType,
	dep: ResolvedDependency,
): CdxLibrary.Models.Component => {
	const component = new cdx.Models.Component(type, dep.name, {
		version: dep.version,
		purl: npmPurl(dep.name, dep.version),
		bomRef: `${dep.name}@${dep.version}`,
	});
	if (dep.description) component.description = dep.description;
	if (dep.license) component.licenses.add(new cdx.Models.NamedLicense(dep.license));
	return component;
};

const makeSupplier = (cdx: typeof CdxLibrary, supplier: SbomSupplier): CdxLibrary.Models.OrganizationalEntity => {
	const entity = new cdx.Models.OrganizationalEntity({ name: supplier.name });
	for (const url of supplier.url ?? []) entity.url.add(url);
	for (const contact of supplier.contact ?? []) {
		entity.contact.add(
			new cdx.Models.OrganizationalContact({
				name: contact.name,
				email: contact.email,
				phone: contact.phone,
			}),
		);
	}
	return entity;
};

const addAuthors = (
	cdx: typeof CdxLibrary,
	repo: CdxLibrary.Models.OrganizationalContactRepository,
	authors: ReadonlyArray<SbomAuthor>,
): void => {
	for (const author of authors) {
		repo.add(
			new cdx.Models.OrganizationalContact({
				name: author.name,
				email: author.email,
				phone: author.phone,
			}),
		);
	}
};

const buildBom = (cdx: typeof CdxLibrary, input: SbomInput): CycloneDXBom => {
	const root = new cdx.Models.Component(cdx.Enums.ComponentType.Library, input.rootName, {
		version: input.rootVersion,
		purl: npmPurl(input.rootName, input.rootVersion),
		bomRef: `${input.rootName}@${input.rootVersion}`,
	});
	if (input.rootDescription) root.description = input.rootDescription;
	if (input.rootLicense) root.licenses.add(new cdx.Models.NamedLicense(input.rootLicense));
	if (input.rootAuthor) root.author = input.rootAuthor;

	const metadata = new cdx.Models.Metadata({ component: root, timestamp: new Date() });
	if (input.supplier) metadata.supplier = makeSupplier(cdx, input.supplier);
	if (input.authors) addAuthors(cdx, metadata.authors, input.authors);
	const bom = new cdx.Models.Bom({ metadata });

	const resolved = resolveDependencies(input.dependencies, input.inFlightPackages);
	for (const dep of resolved) {
		bom.components.add(makeComponent(cdx, cdx.Enums.ComponentType.Library, dep));
	}
	return bom;
};

const serializeBom = (cdx: typeof CdxLibrary, bom: CycloneDXBom): string => {
	const factory = new cdx.Serialize.JSON.Normalize.Factory(cdx.Spec.Spec1dot5);
	const serializer = new cdx.Serialize.JsonSerializer(factory);
	return serializer.serialize(bom, { sortLists: true, space: 2 });
};

const resolveDependencies = (
	dependencies: ReadonlyArray<ResolvedDependency>,
	inFlight: ReadonlyArray<InFlightPackage> | undefined,
): ResolvedDependency[] => {
	const byName = new Map<string, ResolvedDependency>();
	for (const dep of dependencies) byName.set(dep.name, dep);
	for (const pkg of inFlight ?? []) {
		// In-flight packages replace any same-named dependency entry — the
		// registry doesn't have this version yet, so the resolver would
		// have produced a stale answer if it returned anything at all.
		const replacement: ResolvedDependency = pkg.license
			? { name: pkg.name, version: pkg.version, license: pkg.license }
			: { name: pkg.name, version: pkg.version };
		byName.set(pkg.name, replacement);
	}
	return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Live {@link Sbom} layer.
 *
 * @public
 */
export const SbomLive = Layer.succeed(Sbom, {
	generate: (input) =>
		Effect.tryPromise({
			try: async () => buildBom(await loadCdx(), input),
			catch: (cause) =>
				new SbomError({
					reason: "build",
					message: `Failed to build CycloneDX BOM: ${cause instanceof Error ? cause.message : String(cause)}`,
					cause,
				}),
		}),

	serializeJson: (bom) =>
		Effect.tryPromise({
			try: async () => serializeBom(await loadCdx(), bom),
			catch: (cause) =>
				new SbomError({
					reason: "serialize",
					message: `Failed to serialize CycloneDX BOM to JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
					cause,
				}),
		}),

	save: (bom, path) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const sbom = yield* Effect.tryPromise({
				try: async () => serializeBom(await loadCdx(), bom),
				catch: (cause) =>
					new SbomError({
						reason: "serialize",
						message: `Failed to serialize CycloneDX BOM to JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
						cause,
					}),
			});
			yield* fs.writeFileString(path, sbom).pipe(
				Effect.mapError(
					(error) =>
						new SbomError({
							reason: "save",
							message: `Failed to write SBOM to ${path}: ${error.message}`,
							cause: error,
						}),
				),
			);
		}),
});
