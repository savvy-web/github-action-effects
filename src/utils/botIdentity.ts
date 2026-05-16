import type { BotIdentity } from "../services/GitHubApp.js";

/** Source fields for deriving a {@link BotIdentity}. */
interface BotIdentitySource {
	readonly appSlug?: string | undefined;
	readonly appUserId?: number | undefined;
}

/**
 * Derive a bot identity for commit/tag attribution.
 *
 * When both `appSlug` and `appUserId` are present, returns a verified identity
 * whose email carries the numeric user-ID prefix GitHub recognises for
 * verified attribution. Otherwise falls back to the well-known
 * `github-actions[bot]` identity (with the `41898282+` prefix).
 */
export const formatBotIdentity = (source?: BotIdentitySource): BotIdentity => {
	if (source?.appSlug !== undefined && source.appUserId !== undefined) {
		const name = `${source.appSlug}[bot]`;
		return { name, email: `${source.appUserId}+${name}@users.noreply.github.com` };
	}
	return {
		name: "github-actions[bot]",
		email: "41898282+github-actions[bot]@users.noreply.github.com",
	};
};
