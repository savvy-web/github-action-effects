/**
 * \@savvy-web/github-action-effects
 *
 * Effect-based utility library for building robust, well-logged,
 * and schema-validated GitHub Actions.
 *
 * @packageDocumentation
 */

// -- Errors --
export { ActionInputError, ActionInputErrorBase } from "./errors/ActionInputError.js";
export { ActionOutputError, ActionOutputErrorBase } from "./errors/ActionOutputError.js";
export { ActionStateError, ActionStateErrorBase } from "./errors/ActionStateError.js";

// -- Layers --
export { ActionInputsLive } from "./layers/ActionInputsLive.js";
export { ActionInputsTest } from "./layers/ActionInputsTest.js";
export {
	ActionLoggerLayer,
	ActionLoggerLive,
	CurrentLogLevel,
	makeActionLogger,
	setLogLevel,
} from "./layers/ActionLoggerLive.js";
export { ActionLoggerTest, type ActionLoggerTestState, type TestAnnotationType } from "./layers/ActionLoggerTest.js";
export { ActionOutputsLive } from "./layers/ActionOutputsLive.js";
export { ActionOutputsTest, type ActionOutputsTestState } from "./layers/ActionOutputsTest.js";
export { ActionStateLive } from "./layers/ActionStateLive.js";
export { ActionStateTest, type ActionStateTestState } from "./layers/ActionStateTest.js";
// -- Runner --
export { runAction } from "./runAction.js";
// -- Schemas --
export { CapturedOutput, ChecklistItem, Status } from "./schemas/GithubMarkdown.js";
export { ActionLogLevel, LogLevelInput, resolveLogLevel } from "./schemas/LogLevel.js";
// -- Services --
export { ActionInputs } from "./services/ActionInputs.js";
export { ActionLogger } from "./services/ActionLogger.js";
export { ActionOutputs } from "./services/ActionOutputs.js";
export { ActionState } from "./services/ActionState.js";
export { type InputConfig, parseAllInputs } from "./services/parseAllInputs.js";

// -- GFM Builders (pure functions) --
export {
	bold,
	checklist,
	code,
	codeBlock,
	details,
	heading,
	link,
	list,
	rule,
	statusIcon,
	table,
} from "./utils/GithubMarkdown.js";
