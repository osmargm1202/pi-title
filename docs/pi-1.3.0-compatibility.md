# Pi 1.3.0 compatibility audit

## Scope and reference

This report covers `pi-title`. No commits, pushes, global Pi configuration changes, or paid model calls were made.

The reference installation was:

```text
/home/osmarg/.bun/install/global/node_modules/@earendil-works/pi-coding-agent
```

Read the installed `docs/extensions.md` completely before implementation, together with relevant installed docs: `models.md`, `providers.md`, `custom-provider.md`, `virtual-models.md`, `sessions.md`, `session-format.md`, `message-types.md`, `packages.md`, `configuration.md`, `tui.md`, and `sdk.md`. Checked installed examples `session-name.ts`, `summarize.ts`, `custom-compaction.ts`, and SDK examples `06-extensions.ts` and `09-api-keys-and-oauth.ts`, plus the installed API declarations/runtime implementation for exact contracts.

All three existing host development dependencies (`pi-agent-core`, `pi-ai`, `pi-coding-agent` under `@earendil-works`) now pin **exactly `1.3.0`**. They remain `"*"` peers, not runtime dependencies. TypeScript and Node declarations are development-only. The lockfile was regenerated with scripts disabled.

## Fixes

- Replaced the direct `pi-ai.complete()`/manual API-key lookup with `ctx.modelRegistry.streamSimple(...).result()`. The host now owns provider authentication, endpoint/header/environment resolution, and virtual-model routing. A nonempty API key is no longer incorrectly required for ambient/keyless auth.
- Capture the selected model at request start. A later model selection applies to the next generation; no provider-specific model or fallback is chosen by this extension.
- Capture the user prompt in `before_agent_start`, then start automatic generation in `agent_start`. Host source inspection confirmed `ExtensionRunner` reads `AgentSession.agent.signal`, which is **undefined during `before_agent_start`** and becomes available only once agent-core starts the run. Combine that real run signal with the local controller. Commands without an operation signal still use a local controller. Cancellation immediately removes the generating state and stops the spinner, even if the provider finishes late or ignores cancellation. Discard captured prompts on custom triggers, shutdown, restoration, and manual cancellation.
- Invalidate request identity before aborting on clear, manual rename, replacement generation, shutdown, session start, or tree navigation. Late results/errors cannot rename or append state to a replacement session/branch.
- Restore saved state from `getBranch()`, not all entries. Empty clear entries remain effective. Reconstruct state on `session_tree` as well as `session_start`.
- Regenerate from `buildSessionProjection()` so compaction and append-only context edits are respected, rather than re-exposing obsolete/raw message content.
- Ignore custom-message `before_agent_start` events: Pi 1.3.0 does not supply `prompt` for them. Missing model/UI or an already-aborted operation does not consume the automatic attempt.
- Reject empty, error, aborted, or non-text-operation results instead of accepting partial error text as a title. Successful `stop` and `length` responses may supply a title.
- Replace unsupported notification level `success` with `info`.
- Added strict source/TypeScript-test typechecking. Fixed pre-existing local helper errors exposed by it: duplicate object keys, a missing filter type predicate, and an unnecessary unsafe config assertion. No unrelated helper behavior was redesigned.

## Verification

Environment: **Node.js v22.23.3**, **npm 10.9.9**, **TypeScript 5.9.3**, `@types/node` **22.20.5**.

| Check | Result |
| --- | --- |
| `npm install --ignore-scripts` | Passed; 119 packages added, 120 audited, 0 vulnerabilities |
| `npm ci --ignore-scripts` | Passed; clean lockfile install, 119 packages added, 120 audited, 0 vulnerabilities |
| `npm test` | **29 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo** (after independent-review follow-up) |
| `npm run typecheck` | Passed (`tsc --noEmit`, strict source and TypeScript tests; dependency declaration checking skipped) |
| `npm ls --depth=0` | Passed; all three host development packages resolve to `1.3.0` |
| `npm run pack:check` | Passed (`npm pack --dry-run`); 7 files, including this report, no `node_modules` |
| `git diff --check` | Passed |

The total includes the package-shape test, the existing TypeScript helper/rendering assertion file, and **27 named runtime tests** in `test/title-runtime.test.mjs`. Runtime tests execute the actual extension factory, with in-memory Pi `SessionManager` instances and controlled deferred streams. They cover provider-neutral dispatch, response sanitization/failures, user/custom triggers, missing models/headless behavior, selection changes, synchronous dispatch errors, turn cancellation and spinner cleanup, late completions/rejections, clear/manual replacement, idempotent shutdown, reload/new/resume/fork restoration, defensive session start, branch navigation, compaction/context redaction, and isolated config persistence.

Additional integration coverage within those tests:

- Pi 1.3.0's **real TypeScript extension loader** discovers the entry and registers the command/lifecycle handlers with **zero errors or warnings**.
- Pi 1.3.0's **real AgentSession** runs the loaded extension with in-memory session/settings/credential/catalog stores and an in-process provider. It asserts the actual `before_agent_start` signal is undefined and the `agent_start` signal exists, calls `session.abort()`, verifies the title signal is aborted and spinner stopped, then completes the deliberately cancellation-ignoring title stream successfully. Neither the session name nor any title/error entries may change. Unit lifecycle helpers also model the two distinct phases rather than injecting a synthetic signal into `before_agent_start`.
- Pi 1.3.0's **real ModelRuntime and ModelRegistry** route a virtual selection (`reason: "direct"`) to an in-process fake physical provider using keyless auth, preserving resolved endpoint, headers, provider-scoped environment, cancellation signal, and normalized system messages. The API-specific `stream()` path is deliberately forbidden.

Tests use temporary `HOME` directories, in-memory credential/catalog stores, no model network refresh, and a throwing `fetch` guard. No user config or credentials are modified. Node prints an expected experimental warning for its mock-timer API; npm reports the upstream `node-domexception@1.0.0` deprecation. Neither is a verification failure.

## Limits and remaining risks

- This is an **exact-version 1.3.0 audit**, not a claim that every version permitted by wildcard peers is compatible.
- No real hosted/local model endpoint, OAuth refresh service, Bedrock/Vertex ambient credential chain, or paid response was exercised. Provider handling is validated through host runtime dispatch and an in-process fake provider, not vendor wire protocols.
- Cancellation is exercised through a real `AgentSession`; lifecycle replacement/tree tests still drive extension handlers with real in-memory session state. They do not automate a full CLI `/new`, `/resume`, `/fork`, `/reload`, or RPC client. Interactive footer rendering and downstream `pi-footer`/bundle integration are outside this repository's scope.
- Existing policy is retained: generation requires `ctx.hasUI`; `clear` hides title state without clearing the separate Pi session name; automatic generation is attempted once per restored session/branch until restoration resets it.
- Background title-call usage is still not persisted as Pi session usage entries, so session totals do not include this auxiliary model work. No accounting redesign was included in this compatibility fix.
- The existing rendering helpers' simple code-point width behavior remains unchanged; comprehensive wide-character/combining-mark terminal layout was not audited here.
