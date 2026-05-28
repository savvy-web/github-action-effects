/**
 * Step-8a tests for the Attest service: SLSA predicate helpers.
 *
 * @remarks
 * Pure functions, no Effect plumbing beyond `runPromise`/`runSync`.
 * The shape of the predicate is asserted against the snapshot
 * `@actions/attest` produces so verifiers can't tell the two paths
 * apart.
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { OidcClaims } from "../testing.js";
import { GITHUB_BUILD_TYPE, buildSLSAProvenancePredicate, decodeJwtClaims } from "../testing.js";

const base64UrlEncode = (obj: unknown): string =>
	Buffer.from(JSON.stringify(obj), "utf-8")
		.toString("base64")
		.replace(/=+$/, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");

const fakeJwt = (payload: Record<string, unknown>): string => {
	const header = base64UrlEncode({ alg: "RS256", typ: "JWT" });
	const body = base64UrlEncode(payload);
	return `${header}.${body}.signature-not-verified`;
};

const fullClaims: OidcClaims = {
	iss: "https://token.actions.githubusercontent.com",
	ref: "refs/heads/main",
	sha: "deadbeef".repeat(5),
	repository: "savvy-web/silk-integration",
	event_name: "push",
	job_workflow_ref: "savvy-web/silk-release-action/.github/workflows/release.yml@refs/heads/main",
	workflow_ref: "savvy-web/silk-integration/.github/workflows/release.yml@refs/heads/main",
	repository_id: "123456",
	repository_owner_id: "654321",
	runner_environment: "github-hosted",
	run_id: "987654",
	run_attempt: "1",
};

describe("decodeJwtClaims — step 8a", () => {
	it("extracts the payload from a valid 3-segment JWT", async () => {
		const token = fakeJwt(fullClaims);
		const decoded = await Effect.runPromise(decodeJwtClaims(token));
		expect(decoded.repository).toBe("savvy-web/silk-integration");
		expect(decoded.run_id).toBe("987654");
	});

	it("fails with `decode` reason on a malformed JWT", async () => {
		const exit = await Effect.runPromiseExit(decodeJwtClaims("not-a-jwt"));
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure") {
			expect(JSON.stringify(exit.cause)).toContain('"reason":"decode"');
		}
	});

	it("fails with `claims` reason when required claims are missing", async () => {
		const { run_id: _, ...partial } = fullClaims;
		void _;
		const token = fakeJwt(partial);

		const exit = await Effect.runPromiseExit(decodeJwtClaims(token));
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure") {
			const cause = JSON.stringify(exit.cause);
			expect(cause).toContain('"reason":"claims"');
			expect(cause).toContain("run_id");
		}
	});
});

describe("buildSLSAProvenancePredicate — step 8a", () => {
	it("produces a SLSA v1 predicate with the GitHub workflow build type", async () => {
		const predicate = (await Effect.runPromise(
			buildSLSAProvenancePredicate(fullClaims, { GITHUB_SERVER_URL: "https://github.com" }),
		)) as {
			buildDefinition: {
				buildType: string;
				externalParameters: { workflow: { ref: string; repository: string; path: string } };
				internalParameters: { github: { event_name: string } };
				resolvedDependencies: Array<{ uri: string; digest: { gitCommit: string } }>;
			};
			runDetails: {
				builder: { id: string };
				metadata: { invocationId: string };
			};
		};

		expect(predicate.buildDefinition.buildType).toBe(GITHUB_BUILD_TYPE);
		expect(predicate.buildDefinition.externalParameters.workflow).toEqual({
			ref: "refs/heads/main",
			repository: "https://github.com/savvy-web/silk-integration",
			path: ".github/workflows/release.yml",
		});
		expect(predicate.buildDefinition.internalParameters.github.event_name).toBe("push");
		expect(predicate.buildDefinition.resolvedDependencies[0]).toEqual({
			uri: "git+https://github.com/savvy-web/silk-integration@refs/heads/main",
			digest: { gitCommit: "deadbeef".repeat(5) },
		});
		expect(predicate.runDetails.builder.id).toBe(
			"https://github.com/savvy-web/silk-release-action/.github/workflows/release.yml@refs/heads/main",
		);
		expect(predicate.runDetails.metadata.invocationId).toBe(
			"https://github.com/savvy-web/silk-integration/actions/runs/987654/attempts/1",
		);
	});

	it("defaults GITHUB_SERVER_URL to https://github.com", async () => {
		const predicate = (await Effect.runPromise(buildSLSAProvenancePredicate(fullClaims, {}))) as {
			buildDefinition: { externalParameters: { workflow: { repository: string } } };
		};
		expect(predicate.buildDefinition.externalParameters.workflow.repository).toBe(
			"https://github.com/savvy-web/silk-integration",
		);
	});

	it("honors GITHUB_SERVER_URL for GHES deployments", async () => {
		const predicate = (await Effect.runPromise(
			buildSLSAProvenancePredicate(fullClaims, { GITHUB_SERVER_URL: "https://github.example.com" }),
		)) as {
			buildDefinition: { externalParameters: { workflow: { repository: string } } };
			runDetails: { builder: { id: string } };
		};
		expect(predicate.buildDefinition.externalParameters.workflow.repository).toBe(
			"https://github.example.com/savvy-web/silk-integration",
		);
		expect(predicate.runDetails.builder.id).toBe(
			"https://github.example.com/savvy-web/silk-release-action/.github/workflows/release.yml@refs/heads/main",
		);
	});

	it("end-to-end: decode + build round-trip", async () => {
		const token = fakeJwt(fullClaims);
		const predicate = await Effect.runPromise(
			Effect.gen(function* () {
				const claims = yield* decodeJwtClaims(token);
				return yield* buildSLSAProvenancePredicate(claims, { GITHUB_SERVER_URL: "https://github.com" });
			}),
		);
		expect(predicate).toMatchObject({ buildDefinition: { buildType: GITHUB_BUILD_TYPE } });
	});
});
