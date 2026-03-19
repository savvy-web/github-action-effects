import { Context } from "effect";

/**
 * Properties for file/line annotations in the GitHub Actions UI.
 *
 * @public
 */
export interface AnnotationProperties {
	readonly title?: string;
	readonly file?: string;
	readonly startLine?: number;
	readonly endLine?: number;
	readonly startColumn?: number;
	readonly endColumn?: number;
}

/**
 * Wrapper service for `@actions/core`.
 *
 * Consumers provide this via {@link ActionsCoreLive} (standard) or a mock
 * layer (testing). Live layers depend on this service instead of importing
 * `@actions/core` directly.
 *
 * @public
 */
export class ActionsCore extends Context.Tag("github-action-effects/ActionsCore")<
	ActionsCore,
	{
		readonly getInput: (name: string, options?: { required?: boolean; trimWhitespace?: boolean }) => string;
		readonly getMultilineInput: (name: string, options?: { required?: boolean; trimWhitespace?: boolean }) => string[];
		readonly getBooleanInput: (name: string) => boolean;
		readonly setOutput: (name: string, value: string) => void;
		readonly setFailed: (message: string | Error) => void;
		readonly exportVariable: (name: string, value: string) => void;
		readonly addPath: (path: string) => void;
		readonly setSecret: (name: string) => void;
		readonly info: (message: string) => void;
		readonly debug: (message: string) => void;
		readonly warning: (message: string | Error, properties?: AnnotationProperties) => void;
		readonly error: (message: string | Error, properties?: AnnotationProperties) => void;
		readonly notice: (message: string, properties?: AnnotationProperties) => void;
		readonly startGroup: (name: string) => void;
		readonly endGroup: () => void;
		readonly getState: (name: string) => string;
		readonly saveState: (name: string, value: string) => void;
		readonly summary: { write: () => Promise<unknown>; addRaw: (text: string) => { write: () => Promise<unknown> } };
	}
>() {}
