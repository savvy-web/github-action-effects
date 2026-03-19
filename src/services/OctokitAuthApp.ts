import { Context } from "effect";

/**
 * Auth function returned by `createAppAuth`.
 *
 * @public
 */
export interface AppAuth {
	(options: { type: "app" }): Promise<{ token: string }>;
	(options: {
		type: "installation";
		installationId: number;
	}): Promise<{
		token: string;
		expiresAt: string;
		installationId: number;
		permissions: Record<string, string>;
	}>;
}

/**
 * Wrapper service for `@octokit/auth-app`.
 *
 * @public
 */
export class OctokitAuthApp extends Context.Tag("github-action-effects/OctokitAuthApp")<
	OctokitAuthApp,
	{
		readonly createAppAuth: (options: { appId: string; privateKey: string }) => AppAuth;
	}
>() {}
