import { Effect } from "effect";
import { ArtifactError } from "../../errors/ArtifactError.js";

/**
 * Backend identifiers decoded from the GitHub Actions runtime token's `scp`
 * claim. The artifact Twirp API requires both on every upload/list/get/delete
 * call to scope the operation to the current run + job.
 *
 * @internal
 */
export interface BackendIds {
	readonly workflowRunBackendId: string;
	readonly workflowJobRunBackendId: string;
}

type ArtifactOperation = "upload" | "download" | "list" | "get" | "delete";

/**
 * Decode the base64url-encoded payload segment of a JWT.
 *
 * Mirrors `slsa.ts`'s `base64UrlDecode` — we do not verify the signature; the
 * token came from the runner over TLS and we read only the `scp` claim.
 */
const base64UrlDecode = (segment: string): string => {
	const padded = segment
		.replace(/-/g, "+")
		.replace(/_/g, "/")
		.padEnd(Math.ceil(segment.length / 4) * 4, "=");
	return Buffer.from(padded, "base64").toString("utf-8");
};

/**
 * Decode `workflowRunBackendId` / `workflowJobRunBackendId` from a GitHub
 * Actions runtime token (`ACTIONS_RUNTIME_TOKEN`).
 *
 * @remarks
 * The runtime token is a JWT whose `scp` (scope) claim is a space-separated
 * list. The artifact backend IDs live in the scope beginning with
 * `Actions.Results:`, formatted `Actions.Results:<runBackendId>:<jobRunBackendId>`.
 * This mirrors `@actions/artifact`'s `getBackendIdsFromToken`
 * (`artifact/src/internal/shared/util.ts`). The runtime token is NOT an OIDC
 * token, so it lacks the claims `slsa.decodeJwtClaims` requires — we reuse only
 * the base64url payload-decoding technique, not that validator.
 *
 * @internal
 */
export const getBackendIdsFromToken = (
	token: string,
	artifact: string,
	operation: ArtifactOperation,
): Effect.Effect<BackendIds, ArtifactError> =>
	Effect.try({
		try: () => {
			const parts = token.split(".");
			if (parts.length !== 3) {
				throw new Error(`Expected a 3-segment JWT, got ${parts.length}`);
			}
			const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
			const scp = payload.scp;
			if (typeof scp !== "string") {
				throw new Error("Runtime token is missing a string `scp` claim");
			}
			for (const scope of scp.split(" ")) {
				const scopeParts = scope.split(":");
				if (scopeParts[0] !== "Actions.Results") {
					continue;
				}
				if (scopeParts.length !== 3 || !scopeParts[1] || !scopeParts[2]) {
					throw new Error(`Malformed Actions.Results scope: "${scope}"`);
				}
				return {
					workflowRunBackendId: scopeParts[1],
					workflowJobRunBackendId: scopeParts[2],
				};
			}
			throw new Error("Runtime token has no `Actions.Results` scope");
		},
		catch: (error) =>
			new ArtifactError({
				operation,
				artifact,
				reason: error instanceof Error ? error.message : String(error),
			}),
	});

/**
 * Read `ACTIONS_RUNTIME_TOKEN` from the environment and decode the backend IDs.
 *
 * @internal
 */
export const getBackendIdsFromEnv = (
	artifact: string,
	operation: ArtifactOperation,
): Effect.Effect<BackendIds, ArtifactError> =>
	Effect.suspend(() => {
		const token = process.env.ACTIONS_RUNTIME_TOKEN;
		if (!token) {
			return Effect.fail(
				new ArtifactError({
					operation,
					artifact,
					reason: "Missing required env var: ACTIONS_RUNTIME_TOKEN",
				}),
			);
		}
		return getBackendIdsFromToken(token, artifact, operation);
	});
