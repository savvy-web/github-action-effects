import type * as CdxLibrary from "@cyclonedx/cyclonedx-library";
import type { FileSystem } from "@effect/platform";
import type { Effect } from "effect";
import { Context } from "effect";
import type { SbomError } from "../errors/SbomError.js";

/**
 * A dependency that should appear as a component in the BOM.
 *
 * @public
 */
export interface ResolvedDependency {
	readonly name: string;
	readonly version: string;
	readonly license?: string;
	readonly description?: string;
}

/**
 * A sibling package being released in the same wave as the root —
 * not yet on the registry, so any registry-based dependency resolver
 * cannot see it. The Sbom service uses this list to synthesize the
 * component entry the registry would otherwise provide.
 *
 * @public
 */
export interface InFlightPackage {
	readonly name: string;
	readonly version: string;
	readonly license?: string;
}

/**
 * A point of contact for a supplier organization.
 *
 * @public
 */
export interface SbomContact {
	readonly name?: string;
	readonly email?: string;
	readonly phone?: string;
}

/**
 * The organization that supplied the root component. Maps to the
 * CycloneDX `metadata.supplier` field, which the NTIA SBOM "minimum
 * elements" require for compliance.
 *
 * @public
 */
export interface SbomSupplier {
	/** Supplier organization name. Required for NTIA compliance. */
	readonly name: string;
	/** Optional supplier URL(s). */
	readonly url?: ReadonlyArray<string>;
	/** Optional supplier point(s) of contact. */
	readonly contact?: ReadonlyArray<SbomContact>;
}

/**
 * An author of the SBOM document itself. Maps to a CycloneDX
 * `metadata.authors` entry — the NTIA "author of SBOM data" element,
 * distinct from the {@link SbomInput.rootAuthor} that describes the
 * author of the root *component*.
 *
 * @public
 */
export interface SbomAuthor {
	readonly name?: string;
	readonly email?: string;
	readonly phone?: string;
}

/**
 * Input for {@link Sbom.generate}.
 *
 * @public
 */
export interface SbomInput {
	/** Name of the root package the BOM describes. */
	readonly rootName: string;
	/** Version of the root package. */
	readonly rootVersion: string;
	/** Optional root-level metadata. */
	readonly rootLicense?: string;
	readonly rootDescription?: string;
	readonly rootAuthor?: string;
	/**
	 * Supplier of the root component. Threaded onto `metadata.supplier`
	 * of the emitted BOM — required by the NTIA SBOM minimum elements.
	 */
	readonly supplier?: SbomSupplier;
	/**
	 * Authors of the SBOM document. Threaded onto `metadata.authors` of
	 * the emitted BOM — the NTIA "author of SBOM data" element. This is
	 * distinct from {@link rootAuthor}, which describes the author of
	 * the root component rather than of the SBOM itself.
	 */
	readonly authors?: ReadonlyArray<SbomAuthor>;
	/**
	 * Resolved direct dependencies (post-relink) of the root package.
	 * Workspace references should already be replaced with concrete
	 * versions before being passed in.
	 */
	readonly dependencies: ReadonlyArray<ResolvedDependency>;
	/**
	 * Packages being released alongside the root that aren't on the
	 * registry yet. If any of these names also appear in
	 * {@link dependencies}, the in-flight version wins.
	 */
	readonly inFlightPackages?: ReadonlyArray<InFlightPackage>;
}

/**
 * CycloneDX BOM model. Re-exported so callers don't need to depend on
 * `@cyclonedx/cyclonedx-library` directly.
 *
 * @public
 */
export type CycloneDXBom = CdxLibrary.Models.Bom;

/**
 * Sbom service surface.
 *
 * @public
 */
export class Sbom extends Context.Tag("github-action-effects/Sbom")<
	Sbom,
	{
		/** Build an in-memory CycloneDX 1.5 BOM from the resolved dependency graph. */
		readonly generate: (input: SbomInput) => Effect.Effect<CycloneDXBom, SbomError>;

		/** Serialize a BOM to JSON. The result is the canonical CycloneDX JSON form. */
		readonly serializeJson: (bom: CycloneDXBom) => Effect.Effect<string, SbomError>;

		/** Write a BOM to disk as pretty-printed JSON. */
		readonly save: (bom: CycloneDXBom, path: string) => Effect.Effect<void, SbomError, FileSystem.FileSystem>;
	}
>() {}
