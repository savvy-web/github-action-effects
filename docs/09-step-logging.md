# Step-buffered logging patterns

`Step.withStep` runs an Effect with its debug and info logs captured instead of printed live. On success it emits one summary line and discards the buffer; on failure it prints a `❌ <name>` header, spills the buffered lines indented underneath, then propagates the original error untouched. The result is a quiet log on the happy path and full context exactly where something broke. Warnings and errors are never buffered — they pass straight through, because they map to GitHub Actions annotations whose UI affordances would be lost if held back.

`Step` is a top-level namespace, like `Action`. It exports `withStep`, `success`, `failure`, `collapse` and `groupStep`. For the runtime that backs it, see [architecture](./14-architecture.md#runtime-layer).

## withStep and success

Wrap a unit of work in `withStep`. Inside the body, call `Step.success(line)` to set the text shown to the right of the library-managed `✅ <name>:` prefix. The library owns the icon and the `<name>:` prefix; the body passes only the outcome.

```typescript
import { Effect } from "effect"
import { PackagePublish, Step } from "@savvy-web/github-action-effects"

const packStep = Effect.gen(function* () {
  const publisher = yield* PackagePublish

  yield* Step.withStep("pack dist/npm", Effect.gen(function* () {
    const result = yield* publisher.pack("./dist/npm")
    yield* Effect.logDebug(`packed ${result.tarballPath}`)  // buffered, not printed on success
    yield* Step.success(`${result.name}@${result.version} (${result.fileCount} files)`)
    return result
  }))
})
// On success, one line: ✅ pack dist/npm: my-pkg@1.2.3 (42 files)
```

When the step fails, the success line never appears. Instead the header and the buffered debug lines spill, then the error propagates:

```text
❌ pack dist/npm: ENOENT: no such file or directory
  packed /tmp/build/dist/npm   (the buffered debug lines, indented)
```

The exact paths, byte counts and file counts depend on the build, so treat the numbers above as illustrative.

## defaultSummary

When a step's summary is always the same shape, pass a `defaultSummary` builder instead of calling `Step.success` in the body. `withStep` calls it with the step's result if the body never set an explicit summary:

```typescript
import { Effect } from "effect"
import { Step } from "@savvy-web/github-action-effects"

const program = Step.withStep(
  "resolve versions",
  Effect.succeed({ count: 7 }),
  { defaultSummary: (result) => `${result.count} packages` },
)
// On success: ✅ resolve versions: 7 packages
```

An explicit `Step.success` inside the body wins over `defaultSummary`. With neither set, the step emits the bare `✅ resolve versions` line.

## collapse

`Step.collapse` runs N steps in parallel and reduces them to a single line when they all succeed. The reducer receives `{ name, result }` pairs in input order; return a string to emit that one line instead of N per-step lines, or `null` to abandon the collapse and let each child emit its own line.

```typescript
import { Effect } from "effect"
import { NpmRegistry, Step } from "@savvy-web/github-action-effects"

const probeAll = Effect.gen(function* () {
  const npm = yield* NpmRegistry

  yield* Step.collapse(
    [
      { name: "probe npm", effect: npm.getPublishedIntegrity("@scope/pkg", "1.2.3", { registry: npmUrl }) },
      { name: "probe ghp", effect: npm.getPublishedIntegrity("@scope/pkg", "1.2.3", { registry: ghpUrl }) },
    ],
    (results) => `probed ${results.length} registries`,
  )
})
// On all-success: probed 2 registries
```

On any child failure the collapse is abandoned: every child emits its own success line or failure block, and the first failure's cause is then propagated. The concurrency is unbounded — `collapse` is meant for the small fan-out of parallel registry probes or attestations, typically two to four.

## groupStep

`Step.groupStep` wraps an Effect in both `ActionLogger.group` and `withStep`. That is the natural outer scope for a phase: a collapsible GitHub Actions block with a step summary at the end. It adds `ActionLogger` to the requirements channel, which `ActionsRuntime.Default` already provides.

```typescript
import { Effect } from "effect"
import { Action, Step } from "@savvy-web/github-action-effects"

const phase = Step.groupStep("Publish", Effect.gen(function* () {
  // ... pack, probe, publish, attest ...
  yield* Step.success("3 packages published")
}))

Action.run(phase)
// Renders a collapsible "Publish" group; on success: ✅ Publish: 3 packages published
```

For a non-fatal failure inside a loop — one registry rejecting a publish while siblings succeed — call `Step.failure(line)` instead of failing the effect. The step renders the same `❌` block and buffer spill, but resolves with its value so the surrounding loop can keep going and aggregate the outcome.
