import { Context } from "effect";

/**
 * Options for command execution, subset of `@actions/exec` ExecOptions.
 *
 * @public
 */
export interface ActionsExecOptions {
	readonly cwd?: string;
	readonly env?: Record<string, string>;
	readonly silent?: boolean;
	readonly ignoreReturnCode?: boolean;
	readonly input?: Buffer;
	readonly listeners?: {
		stdout?: (data: Buffer) => void;
		stderr?: (data: Buffer) => void;
	};
}

/**
 * Wrapper service for `@actions/exec`.
 *
 * @public
 */
export class ActionsExec extends Context.Tag("github-action-effects/ActionsExec")<
	ActionsExec,
	{
		readonly exec: (commandLine: string, args?: string[], options?: ActionsExecOptions) => Promise<number>;
	}
>() {}
