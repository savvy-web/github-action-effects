import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type { ArtifactError } from "../../errors/ArtifactError.js";
import { getBackendIdsFromToken } from "./backendIds.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a synthetic (unsigned) JWT carrying the given payload. */
const makeToken = (payload: Record<string, unknown>): string => {
	const b64url = (obj: unknown): string =>
		Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.signature`;
};

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.exit(effect));

const extractError = (exit: Exit.Exit<unknown, ArtifactError>): ArtifactError | undefined =>
	Exit.isFailure(exit) ? (exit.cause as { error?: ArtifactError }).error : undefined;

afterEach(() => {
	delete process.env.ACTIONS_RUNTIME_TOKEN;
});

describe("getBackendIdsFromToken", () => {
	it("extracts run + job backend ids from a synthetic scp claim", async () => {
		const token = makeToken({
			scp: "Actions.Results:run-backend-id:job-backend-id Actions.UploadArtifacts:Other",
		});
		const exit = await run(getBackendIdsFromToken(token, "test-artifact", "upload"));
		expect(Exit.isSuccess(exit)).toBe(true);
		if (Exit.isSuccess(exit)) {
			expect(exit.value).toEqual({
				workflowRunBackendId: "run-backend-id",
				workflowJobRunBackendId: "job-backend-id",
			});
		}
	});

	it("fails when the Actions.Results scope is absent", async () => {
		const token = makeToken({ scp: "Actions.UploadArtifacts:Create Actions.Generic:Read" });
		const exit = await run(getBackendIdsFromToken(token, "test-artifact", "upload"));
		expect(Exit.isFailure(exit)).toBe(true);
		const error = extractError(exit as Exit.Exit<unknown, ArtifactError>);
		expect(error?._tag).toBe("ArtifactError");
		expect(error?.reason).toContain("Actions.Results");
	});

	it("fails when the scp claim is missing entirely", async () => {
		const token = makeToken({ sub: "no-scope-here" });
		const exit = await run(getBackendIdsFromToken(token, "test-artifact", "list"));
		expect(Exit.isFailure(exit)).toBe(true);
		const error = extractError(exit as Exit.Exit<unknown, ArtifactError>);
		expect(error?.reason).toContain("scp");
	});

	it("fails when the token is not a 3-segment JWT", async () => {
		const exit = await run(getBackendIdsFromToken("not-a-jwt", "test-artifact", "upload"));
		expect(Exit.isFailure(exit)).toBe(true);
		const error = extractError(exit as Exit.Exit<unknown, ArtifactError>);
		expect(error?._tag).toBe("ArtifactError");
	});
});

describe("getBackendIdsFromEnv", () => {
	it("reads ACTIONS_RUNTIME_TOKEN and decodes the backend ids", async () => {
		const { getBackendIdsFromEnv } = await import("./backendIds.js");
		process.env.ACTIONS_RUNTIME_TOKEN = makeToken({
			scp: "Actions.Results:env-run-id:env-job-id",
		});
		const exit = await run(getBackendIdsFromEnv("test-artifact", "upload"));
		expect(Exit.isSuccess(exit)).toBe(true);
		if (Exit.isSuccess(exit)) {
			expect(exit.value).toEqual({
				workflowRunBackendId: "env-run-id",
				workflowJobRunBackendId: "env-job-id",
			});
		}
	});

	it("fails when ACTIONS_RUNTIME_TOKEN is unset", async () => {
		const { getBackendIdsFromEnv } = await import("./backendIds.js");
		delete process.env.ACTIONS_RUNTIME_TOKEN;
		const exit = await run(getBackendIdsFromEnv("test-artifact", "upload"));
		expect(Exit.isFailure(exit)).toBe(true);
		const error = extractError(exit as Exit.Exit<unknown, ArtifactError>);
		expect(error?.reason).toContain("ACTIONS_RUNTIME_TOKEN");
	});
});
