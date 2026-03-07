/**
 * \@savvy-web/github-action-effects
 *
 * Effect-based utility library for building robust, well-logged,
 * and schema-validated GitHub Actions.
 *
 * @packageDocumentation
 */

export type { CoreServices, InputConfig, ParsedInputs } from "./Action.js";
// -- Namespaces --
export { Action } from "./Action.js";
// -- Errors --
export { ActionInputError, ActionInputErrorBase } from "./errors/ActionInputError.js";
export { ActionOutputError, ActionOutputErrorBase } from "./errors/ActionOutputError.js";
export { ActionStateError, ActionStateErrorBase } from "./errors/ActionStateError.js";
// -- Layers --
export { ActionInputsLive } from "./layers/ActionInputsLive.js";
export { ActionInputsTest } from "./layers/ActionInputsTest.js";
export { ActionLoggerLayer, ActionLoggerLive, CurrentLogLevel } from "./layers/ActionLoggerLive.js";
export type { ActionLoggerTestState, TestAnnotationType } from "./layers/ActionLoggerTest.js";
export { ActionLoggerTest } from "./layers/ActionLoggerTest.js";
export { ActionOutputsLive } from "./layers/ActionOutputsLive.js";
export type { ActionOutputsTestState } from "./layers/ActionOutputsTest.js";
export { ActionOutputsTest } from "./layers/ActionOutputsTest.js";
export { ActionStateLive } from "./layers/ActionStateLive.js";
export type { ActionStateTestState } from "./layers/ActionStateTest.js";
export { ActionStateTest } from "./layers/ActionStateTest.js";
// -- Schemas --
export { CapturedOutput, ChecklistItem, Status } from "./schemas/GithubMarkdown.js";
export { ActionLogLevel, LogLevelInput } from "./schemas/LogLevel.js";
// -- Services --
export { ActionInputs } from "./services/ActionInputs.js";
export { ActionLogger } from "./services/ActionLogger.js";
export { ActionOutputs } from "./services/ActionOutputs.js";
export { ActionState } from "./services/ActionState.js";
export { GithubMarkdown } from "./utils/GithubMarkdown.js";
