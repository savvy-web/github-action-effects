# Logging and error handling

A GitHub Action's log is its user interface. When a run passes, the log should be short and scannable; when it fails, it should put the cause where the reader will find it. This guide covers how to produce clean, debuggable output: the log-level model, collapsible groups, buffered and step-buffered logging, annotations, secret masking and the error-handling boundary that catches whatever reaches the top of your program.

## The log-level model

Logging runs through Effect's own logger. The `ActionsLogger` installed by `ActionsRuntime.Default` maps each Effect log level to the matching GitHub Actions workflow command, so you write idiomatic Effect and the right command comes out:

| Effect level | Workflow command | Where it shows |
| --- | --- | --- |
| `Effect.logDebug` / `logTrace` | `::debug::` | Visible only with `ACTIONS_STEP_DEBUG=true` |
| `Effect.log` / `logInfo` | stdout | Plain text in the log |
| `Effect.logWarning` | `::warning::` | Yellow annotation |
| `Effect.logError` / `logFatal` | `::error::` | Red annotation |

```typescript
import { Effect } from "effect"

const program = Effect.gen(function* () {
  yield* Effect.logDebug("resolved 12 packages")  // ::debug:: — hidden unless step-debug is on
  yield* Effect.log("publishing")                 // plain stdout
  yield* Effect.logWarning("registry slow")       // ::warning::
  yield* Effect.logError("publish failed")        // ::error::
})
```

Debug lines stay out of the way on a normal run and appear when a maintainer flips on step-debug — so log liberally at debug level. The level-to-command mapping lives in `ActionsLogger`; see [architecture](./14-architecture.md#actionslogger).

## Annotations on the diff

`::warning::` and `::error::` become inline annotations on a pull request diff when you attach `file`, `line` and `col` log annotations. The logger reads those annotations off the Effect log call and emits them as workflow-command properties, producing `::error file=...,line=...::` — the form GitHub renders against the offending line.

```typescript
import { Effect } from "effect"

const program = Effect.logError("unused import").pipe(
  Effect.annotateLogs({ file: "src/index.ts", line: "10", col: "1" }),
)
// ::error file=src/index.ts,line=10,col=1::unused import
```

`ActionLogger` has no annotation methods of its own — annotations come from logging through Effect this way.

## Notices

GitHub has a fourth annotation level, `::notice::`, that sits between info and warning. Effect has no log level there, so it is a dedicated method on the `ActionLogger` service rather than a remapped level. Use it for a neutral callout the reader should see without it reading as a problem.

```typescript
import { Effect } from "effect"
import { ActionLogger } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger
  yield* logger.notice("3 packages published", { title: "Release" })
  // ::notice title=Release::3 packages published
})
```

## Collapsible groups

Wrap a noisy phase in `ActionLogger.group(name, effect)` to render it as a collapsible block in the runner UI — the toolkit's `core.group`. The group's lines start folded; the reader expands the ones they care about.

```typescript
import { Effect } from "effect"
import { ActionLogger } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger
  yield* logger.group("Install dependencies", Effect.gen(function* () {
    yield* Effect.log("resolving")
    yield* Effect.log("linking")
  }))
})
```

When a grouped effect fails, the buffered verbose lines inside it are flushed before the `::endgroup::`, so the failing group keeps its context instead of collapsing it away.

## Buffered logging: quiet on success, verbose on failure

`ActionLogger.withBuffer(label, effect)` captures `info`-level output in memory while the effect runs. On success the buffer is discarded — the reader sees only warnings and errors. On failure the buffer is flushed with labeled delimiters, so the full trail that led to the failure is right there. `Action.run` already wraps your whole program in `withBuffer`, so you get this behaviour for free at the top level; reach for it explicitly to scope a buffer to a sub-phase.

```typescript
import { Effect } from "effect"
import { ActionLogger } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const logger = yield* ActionLogger
  yield* logger.withBuffer("analysis", Effect.gen(function* () {
    yield* Effect.log("step 1 of 4")   // discarded on success, flushed on failure
    yield* Effect.log("step 2 of 4")
    // ...
  }))
})
```

Warnings and errors are never buffered — they pass straight through so their annotations are never suppressed. See [architecture](./14-architecture.md#withbuffer) for the mechanism.

## Step-buffered logging

`Step.withStep` is the per-unit-of-work refinement of buffered logging: it captures a step's debug and info lines, emits one summary line on success (`✅ <name>: <summary>`) and spills the buffer under a `❌ <name>` header on failure. `Step.collapse` reduces a parallel fan-out to one line; `Step.groupStep` combines a group and a step for a phase's outer scope. That is its own guide — see [step-buffered logging patterns](./09-step-logging.md). Use plain `withBuffer` when you want a single buffer around a phase; reach for `Step` when each unit of work should announce its own one-line outcome.

## Mask secrets in logs

A value read through an action input is masked automatically — GitHub knows it is a secret. A value your action generates at runtime is not, so register it with `ActionOutputs.setSecret` (the toolkit's `core.setSecret`). After registration the runner scrubs the value from every subsequent log line, including ones written by child processes.

```typescript
import { Effect } from "effect"
import { ActionOutputs } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const outputs = yield* ActionOutputs
  yield* outputs.setSecret(generatedToken)
  yield* Effect.log(`token: ${generatedToken}`)
  // token: ***   (the runner masks the registered value)
})
```

The complementary discipline is keeping the secret out of logs in the first place. Tokens and private keys are `Redacted<string>` across the secret-bearing API, and a `Redacted` value renders as `<redacted>` if it reaches a log line, so an accidental `Effect.log(token)` cannot leak it. Wrap raw secrets with `Redacted.make(...)` at the boundary and unwrap with `Redacted.value(...)` only where the plain text is genuinely needed. Combine both: redact secrets in your own code, and `setSecret` any value that crosses into a child process or third-party output.

## The error-handling boundary

`Action.run` wraps your program in `Effect.catchAllCause` so no failure goes unhandled. Whatever reaches the top — a typed error, a defect, an interrupt — is formatted by `Action.formatCause`, emitted as an `::error::` workflow command, and `process.exitCode` is set to `1`. You do not write top-level error handling; the action exits cleanly and the message shows in the UI.

```typescript
import { Effect } from "effect"
import { Action } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  // ... your logic; any failure here is caught by Action.run
})

Action.run(program)
```

Handle errors explicitly only when you want custom behaviour — recovering from a specific tagged error, or writing a failure summary before letting the action fail. Match on the tag with `Effect.catchTag`:

```typescript
import { Effect } from "effect"

const program = myEffect.pipe(
  Effect.catchTag("GitHubClientError", (e) =>
    Effect.logError(`API call "${e.operation}" failed: ${e.reason}`),
  ),
)
```

`Action.formatCause` produces a stable `[Tag] message` string from any `Cause` — `[GitHubClientError] 404 Not Found`, `[Error] ENOENT: no such file or directory` — that both humans and log scrapers can parse. The tagged-error catalog, the `formatCause` fallback chain and the full set of `catchTag` recipes are in [error handling](./13-error-handling.md).

## Accumulate errors across a batch

When a batch should not abort on the first failure, do not let an error propagate to `Action.run` — collect them. `ErrorAccumulator.forEachAccumulate` runs every item, captures successes and failures and returns both, so you can log a complete report instead of stopping at item one.

```typescript
import { Effect } from "effect"
import { ErrorAccumulator } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const result = yield* ErrorAccumulator.forEachAccumulate(packages, publishPackage)
  for (const { item, error } of result.failures) {
    yield* Effect.logError(`failed: ${item}`)
    // one ::error:: line per failed item
  }
  yield* Effect.log(`published ${result.successes.length}, failed ${result.failures.length}`)
  // published 2, failed 1   (counts depend on which items failed)
})
```

See [error accumulation](./04-patterns.md#error-accumulation) for the concurrent variant and the result shape.
