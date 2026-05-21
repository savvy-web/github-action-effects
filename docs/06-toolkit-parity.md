# Coming from `@actions/*`

If you have written a GitHub Action before, you reached for the `@actions/*` toolkit: `@actions/core` for inputs and outputs, `@actions/github` for the API, `@actions/exec` to run commands, and so on. This library replaces all of it with native ESM, so there is zero CJS in your dependency tree. This guide is the migration map: for each `@actions/*` package, the equivalent here and how the shape differs.

The big difference is that everything returns an `Effect` instead of a `Promise` or a bare value. Inputs come through Effect's `Config` API, side effects run inside `Effect.gen` and failures live in a typed error channel instead of thrown exceptions. If you are new to Effect, read [building a GitHub Action with Effect](./01-example-action.md) first — it walks one complete action end to end.

This guide is the narrative walkthrough. For a single at-a-glance lookup table of every `@actions/*` package and its replacement, see [the substitution map in architecture](./14-architecture.md#replacing-actions-packages).

## `@actions/core`

`@actions/core` is the toolkit's grab bag — inputs, outputs, state, logging, summaries, paths. It splits across several pieces here.

### Inputs

`core.getInput("name")` becomes `Config.string("name")`. The `ActionsConfigProvider` (wired in by `ActionsRuntime.Default`) reads the `INPUT_*` environment variables GitHub sets, so the key maps the same way the toolkit's does: `Config.string("package-name")` reads `INPUT_PACKAGE-NAME`.

```typescript
import { Config, Effect } from "effect"

const program = Effect.gen(function* () {
  const name = yield* Config.string("package-name") // core.getInput("package-name")
  const count = yield* Config.integer("count")        // core.getInput + parseInt
  const debug = yield* Config.boolean("debug").pipe(Config.withDefault(false))
})
```

For booleans and multiline inputs where you want byte-for-byte toolkit semantics, use `ActionInput` instead of Effect's built-in combinators. `core.getBooleanInput` follows the YAML 1.2 Core Schema exactly — it accepts only `true | True | TRUE | false | False | FALSE` and rejects `yes` / `on` / `1`. Effect's `Config.boolean` is more permissive, so `ActionInput.boolean` exists to match the runtime's strictness:

```typescript
import { Config, Effect } from "effect"
import { ActionInput } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const dryRun = yield* ActionInput.boolean("dry-run")            // core.getBooleanInput
  const paths = yield* ActionInput.multiline("paths").pipe(       // core.getMultilineInput
    Config.withDefault([] as ReadonlyArray<string>),
  )
})
```

### Outputs, state and the step summary

`core.setOutput`, `core.exportVariable`, `core.addPath`, `core.setFailed` and `core.summary` all live on the `ActionOutputs` service. They write through the same `GITHUB_OUTPUT` / `GITHUB_ENV` / `GITHUB_PATH` / `GITHUB_STEP_SUMMARY` env files the toolkit uses.

```typescript
import { Effect } from "effect"
import { ActionOutputs, GithubMarkdown } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const outputs = yield* ActionOutputs
  yield* outputs.set("version", "1.2.3")                 // core.setOutput
  yield* outputs.exportVariable("CACHE_HIT", "true")     // core.exportVariable
  yield* outputs.addPath("/opt/tool/bin")                // core.addPath
  yield* outputs.summary(                                // core.summary.addRaw().write()
    GithubMarkdown.table(["Package", "Status"], [["@scope/pkg", "published"]]),
  )
})
```

`core.summary`'s fluent builder maps onto the `GithubMarkdown` namespace — pure functions that build GFM strings (`table`, `heading`, `details`, `checklist`, `image`, `quote` and more) which you then hand to `outputs.summary`. `image` and `quote` match `core.summary.addImage` / `addQuote`. For multi-target reports (summary plus a PR comment plus a check run from one source), `ReportBuilder` builds the markdown once and writes it to each surface — see [common patterns](./04-patterns.md#report-builder).

`core.setSecret` is `ActionOutputs.setSecret` — register a generated value so the runner masks it in logs. Cross-phase state (`core.saveState` / `core.getState`) is the `ActionState` service, which schema-encodes the value so the `post` phase decodes the same shape. See [the advanced action guide](./02-advanced-action.md).

### Logging

`core.debug` / `core.info` / `core.warning` / `core.error` map onto Effect's own logger. The `ActionsLogger` (installed by `ActionsRuntime.Default`) translates each Effect log level to the matching workflow command, so you call `Effect.logDebug` / `Effect.log` / `Effect.logWarning` / `Effect.logError` and the right `::debug::` / `::warning::` / `::error::` comes out. The two operations the Effect logger does not cover — collapsible groups (`core.startGroup` / `endGroup`) and `::notice::` (`core.notice`) — live on the `ActionLogger` service as `group` and `notice`.

```typescript
import { Effect } from "effect"
import { ActionLogger } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  yield* Effect.logWarning("deprecated input")               // core.warning
  const logger = yield* ActionLogger
  yield* logger.notice("build complete", { title: "CI" })    // core.notice
  yield* logger.group("Install", Effect.log("installing"))   // core.group
})
```

The full logging story — the level-to-command mapping, file/line annotations, buffered output and step logging — is in [logging and error handling](./07-logging-and-error-handling.md).

### Paths

`core.toPosixPath` / `toWin32Path` / `toPlatformPath` are the pure `PathUtils` namespace, no service required.

```typescript
import { PathUtils } from "@savvy-web/github-action-effects"

PathUtils.toPosixPath("a\\b")
// "a/b"
```

## `@actions/github` (context and API)

`@actions/github` gives you two things: a pre-authenticated Octokit (`getOctokit`) and the parsed event context (`context`). They split into `GitHubClient` and `ActionEnvironment`.

### The API client

`getOctokit(token)` becomes a `GitHubClient` layer. It wraps `@octokit/rest` directly — there is no `@actions/github` dependency — and adds retry, rate-limit awareness and streaming pagination. You call REST through `client.rest(operation, fn)` and GraphQL through `client.graphql`:

```typescript
import { Effect, Redacted } from "effect"
import { GitHubClient, GitHubClientLive } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const client = yield* GitHubClient
  const { owner, repo } = yield* client.repo
  const data = yield* client.rest("repos.get", (octokit) =>
    (octokit as { rest: { repos: { get: (p: unknown) => Promise<{ data: unknown }> } } }).rest.repos.get({ owner, repo }),
  )
  yield* Effect.log(`default branch: ${(data as { default_branch: string }).default_branch}`)
  // default branch: main   (whatever the repo's default is)
}).pipe(Effect.provide(GitHubClientLive.fromToken(Redacted.make(process.env.MY_TOKEN ?? ""))))
```

The resilience and pagination behaviour is its own guide — see [resilient GitHub API calls](./08-resilient-github-api.md). For the three credential sources (`fromEnv`, `fromToken`, `fromApp`), see [building a GitHubClient layer](./14-architecture.md#building-a-githubclient-layer).

### The event context

`github.context` becomes the `ActionEnvironment` service. The webhook payload, the `{ owner, repo }` pair and the `{ owner, repo, number }` issue/PR triple all mirror `@actions/github`'s `context.payload` / `context.repo` / `context.issue`. The payload is schema-decoded into a typed `WebhookPayload` — common fields are typed, unknown keys are preserved.

```typescript
import { Effect } from "effect"
import { ActionEnvironment } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const env = yield* ActionEnvironment
  const { owner, repo } = yield* env.repo      // context.repo
  const issue = yield* env.issue               // context.issue → { owner, repo, number }
  const payload = yield* env.payload           // context.payload (typed WebhookPayload)
  yield* Effect.log(`${owner}/${repo}#${issue.number}`)
  // octocat/hello-world#42   (values from the triggering event)
})
```

`env.payload`, `env.repo` and `env.issue` read `GITHUB_EVENT_PATH` and need a `FileSystem`, which `ActionsRuntime.Default` provides. Like `@actions/github`, an absent event path yields an empty payload rather than an error.

## `@actions/glob`

`@actions/glob`'s `create(patterns).glob()` and `hashFiles(patterns)` are the `Glob` service. `Glob.glob` resolves newline- or comma-separated patterns (honoring `!` excludes, `~` expansion and `#` comments) to sorted absolute paths. `Glob.hashFiles` computes the same SHA-256 hash-of-hashes the toolkit produces — useful for cache keys.

```typescript
import { Effect, Option } from "effect"
import { Glob } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const glob = yield* Glob
  const files = yield* glob.glob("src/**/*.ts\n!src/**/*.test.ts")
  yield* Effect.log(`matched ${files.length} files`)
  // matched 37 files   (count depends on the working tree)

  // hashFiles returns Option.none() on no match; the toolkit returns "".
  const hash = yield* glob.hashFiles("**/package-lock.json")
  yield* Effect.log(Option.getOrElse(hash, () => ""))
  // a 64-char hex digest, or "" when nothing matched
})
```

`GlobOptions` accepts the documented `@actions/glob` option names for parity; the ones `node:fs.globSync` cannot enforce (`followSymbolicLinks`, `implicitDescendants`, `matchDirectories`, `omitBrokenSymbolicLinks`) are documented no-ops rather than silent drops.

## `@actions/io`

`@actions/io` splits two ways. The lookups with no `@effect/platform` equivalent — `which` and `findInPath` — are the `IoUtil` namespace. The filesystem mutations — `cp`, `mv`, `rmRF`, `mkdirP` — map directly onto `@effect/platform`'s `FileSystem` and need no wrapper.

```typescript
import { Effect, Option } from "effect"
import { IoUtil } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const git = yield* IoUtil.which("git")        // io.which("git") → Option.none() on miss
  if (Option.isNone(git)) {
    yield* Effect.logWarning("git not found on PATH")
  }
  const node = yield* IoUtil.whichOrFail("node") // io.which("node", true) → fails on miss
})
```

The `cp` / `mv` / `rmRF` / `mkdirP` recipe and the full `IoUtil` behaviour table are in [filesystem I/O](./15-filesystem-io.md).

## `@actions/exec`

`exec.exec` and `exec.getExecOutput` become the `CommandRunner` service. `exec` returns the exit code; `execCapture` returns `{ exitCode, stdout, stderr }`. A non-zero exit fails with `CommandRunnerError` (unlike the toolkit, which resolves and leaves you to check the code), and `execJson` / `execLines` add typed parsing on top.

```typescript
import { Effect } from "effect"
import { CommandRunner } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const runner = yield* CommandRunner
  const out = yield* runner.execCapture("git", ["rev-parse", "HEAD"]) // exec.getExecOutput
  yield* Effect.log(out.stdout.trim())
  // the resolved commit SHA on stdout
})
```

## `@actions/cache`

`cache.saveCache` / `restoreCache` are the `ActionCache` service. It speaks the V2 Twirp cache protocol with Azure Blob Storage — no `@actions/cache` dependency. `restore` returns the matched key wrapped in `Option`, so a miss is `Option.none()` rather than `undefined`.

```typescript
import { Effect, Option } from "effect"
import { ActionCache } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const cache = yield* ActionCache
  const hit = yield* cache.restore(["node_modules"], "deps-abc123")
  if (Option.isNone(hit)) {
    yield* Effect.log("cache miss")
    // ... install, then save
    yield* cache.save(["node_modules"], "deps-abc123")
  }
})
```

`ActionCache` reads the runner-injected `ACTIONS_RESULTS_URL` / `ACTIONS_RUNTIME_TOKEN`, which are present only inside a JS action (`uses:`), not a `run:` step. The same constraint applies to `Artifact`.

## `@actions/artifact`

`@actions/artifact`'s `DefaultArtifactClient` is the `Artifact` service (v2 parity). It uploads, lists, downloads and deletes through the same results backend the toolkit uses. `getArtifact` returns `Option.none()` on a miss instead of throwing `ArtifactNotFoundError`.

```typescript
import { Effect } from "effect"
import { Artifact } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const artifact = yield* Artifact
  const result = yield* artifact.uploadArtifact("dist", ["dist/bundle.js"], ".")
  yield* Effect.log(`uploaded artifact ${result.id} (${result.size} bytes)`)
  // uploaded artifact 1234 (size varies by content)
})
```

Like the toolkit, `Artifact` works only inside a bundled JS action where the runner exposes its backend variables.

## `@actions/tool-cache`

`tool-cache`'s `downloadTool` / `extractTar` / `extractZip` / `cacheDir` / `cacheFile` / `find` are the `ToolInstaller` service, built on `node:https` and `child_process`. It is the low-level primitive set — compose the steps your tool needs (`find`, then `download`, then `extract`, then `cacheDir`) rather than a single opinionated installer.

```typescript
import { Effect, Option } from "effect"
import { ToolInstaller } from "@savvy-web/github-action-effects"

const program = Effect.gen(function* () {
  const tools = yield* ToolInstaller
  const cached = yield* tools.find("shellcheck", "0.10.0") // tc.find
  const path = Option.isSome(cached)
    ? cached.value
    : yield* Effect.gen(function* () {
        const tar = yield* tools.download("https://example.com/shellcheck.tar.gz") // tc.downloadTool
        const dir = yield* tools.extractTar(tar)                                   // tc.extractTar
        return yield* tools.cacheDir(dir, "shellcheck", "0.10.0")                  // tc.cacheDir
      })
  yield* Effect.log(`shellcheck at ${path}`)
})
```

## `@actions/attest`

`@actions/attest`'s `attestProvenance` / `attest` are the `Attest` cluster — `Attest.provenance`, `Attest.sbom` and the lower-level `Attest.attest` / `buildBundle`. It signs an in-toto statement into a Sigstore bundle (via OIDC + Fulcio + Rekor) and uploads it to GitHub's attestation store, producing a predicate shaped to match what `@actions/attest` emits so verifiers see the same structure. The full wiring, the provenance and SBOM shapes and the idempotent-recovery path are in [generating SLSA attestations](./10-slsa-attestations.md).

## `@actions/http-client`

There is no dedicated replacement export. Use `@effect/platform`'s `HttpClient` directly — it is the idiomatic Effect substitute, and `ActionsRuntime.Default` already provides a fetch-backed instance.
