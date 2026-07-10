# Codex Chat-Brain Proof

This document records the result of the first implementation gate: proving
whether Codex CLI can serve as Param's Session Actor chat brain before building
large features on top of it (per `GOAL.md`).

## Update: direct-CLI chat-brain is now IMPLEMENTED (prove on the host)

`CodexCliActor` (`src/runtimes/codex/cli-actor.ts`) implements the direct local
`codex` CLI chat-brain: it runs the configured `codex` command non-interactively
with the compiled Param prompt + a strict JSON output instruction, and parses
stdout into actor outputs. `resolveInference` selects it when
`actor.defaultRuntime === "codex"`, `runtimes.codex.adapter` is `direct-cli`, and
the CLI is available; otherwise it falls back to the MockActor. If the CLI is
missing, times out, errors, or returns unparseable output, the turn degrades to
a safe `no_reply` (it never crashes or delivers garbage). Unit-tested with a fake
runner (valid JSON, fenced JSON, unparseable, non-zero exit, missing binary).

Still UNPROVEN in THIS build environment (no `codex` installed, no auth). It must
be proven on the deployment host: install + `codex login`, then Step 7 of
`docs/DEPLOY_VPS.md` (DM the bot, confirm a coherent reply, tune
`runtimes.codex.args` if Codex does not emit the strict JSON). Record the outcome
below when proven.

## Result (build env): BLOCKED here (documented, with a safe fallback)

Codex chat-brain inference **could not be proven** in the build environment.
This is the explicitly-anticipated "document the blocker and safest fallback"
outcome from `GOAL.md`. Param does **not** build a fake actor on a CLI path that
cannot actually provide chat inference. Instead it runs on a pluggable actor
inference boundary with a deterministic fallback, and the Codex adapter degrades
safely to an honest "unavailable" state.

## What was attempted

Both target paths from `GOAL.md` / `docs/RUNTIME_ADAPTERS.md` were exercised:

1. **Preferred path — AI SDK `HarnessAgent` + `@ai-sdk/harness-codex` +
   `@ai-sdk/sandbox-vercel`.** The Codex adapter (`src/runtimes/codex/`) tries
   this via a **lazy** dynamic import inside `probeHarness()`, wrapped in
   try/catch. It never imports the harness at module load, so a failure cannot
   crash the process.
2. **Required fallback/proof path — direct local `codex` CLI.** The adapter
   probes for the `codex` binary with an injectable command probe and reports
   availability from the real result.

## Exact blockers (with evidence)

Three independent blockers were observed. Any one alone is sufficient; all three
hold here.

1. **No `codex` CLI installed and no subscription auth.**
   `codex --version` → `Executable not found in $PATH: "codex"`. There is no
   ChatGPT/Codex subscription session available in the sandbox.

2. **No sandbox / provider auth for the harness path.**
   `VERCEL_TOKEN`, `VERCEL_OIDC_TOKEN`, and `OPENAI_API_KEY` are all unset, so
   `@ai-sdk/sandbox-vercel` (which needs a Vercel Sandbox + network egress)
   cannot start a Codex bridge even if imported.

3. **The AI SDK harness packages fail to import here.**
   `import("@ai-sdk/harness-codex")` throws:
   `Cannot find module 'zod/v4' from '.../@ai-sdk/harness-codex@1.0.22/dist/index.js'`
   (and the same for `@ai-sdk/harness/agent` via `@ai-sdk/provider-utils`).
   The bun-isolated AI SDK internals expect a `zod/v4` subpath layout that does
   not resolve from their install-cache location. (Import behavior was observed
   to be unstable across runners — it resolved under `bun test` in one run but
   fails under `bun run` — which is itself a reason not to depend on it yet.)

## Why the design is safe regardless

- The Session Actor talks to Param through the `ActorInference` interface
  (`src/actor/inference.ts`). Nothing in Param core assumes a specific provider.
- `CodexChatBrain` (`src/runtimes/codex/chat-brain.ts`) implements that
  interface but reports `isAvailable() === false` here and throws a
  `runtime_unavailable` `ParamError` from `run()` rather than fabricating output.
- The Codex adapter's harness import is **lazy** and guarded, so the worker
  boots and simply falls back (see `src/worker/inference.ts`). An eager import
  would crash `bun run src/worker/main.ts` given blocker (3) — the lazy design
  is load-bearing, not incidental.
- All consequential runtime actions still pass through Param **Action Review**
  (`src/action-review/`). A runtime's own approvals never replace it.

## The proven fallback path

- **Default:** the deterministic `MockActor` (`src/actor/mock-actor.ts`)
  exercises the full loop — reply, react, stay quiet, multiple bubbles, run
  contracts, style guard, stale/steering guard — in Param's voice with no model
  call. It is covered by `tests/unit/actor.test.ts`.
- **Configurable real path:** when a real inference path is available, it plugs
  into the same `ActorInference` interface. `resolveInference()` selects Codex
  chat-brain when the adapter reports available, otherwise the MockActor, and
  logs which path was chosen.

## How to actually enable Codex chat-brain later

On a host where it can be proven:

1. Install the `codex` CLI and complete its login/auth (subscription-backed).
2. Set `runtimes.codex.adapter` in `param.config.local.ts`:
   - `"direct-cli"` to drive the local CLI, or
   - `"ai-sdk-harness"` with a working `@ai-sdk/sandbox-vercel` token
     (`VERCEL_TOKEN`/OIDC) and a resolvable `zod/v4` (align the AI SDK + zod
     versions so the subpath resolves under the runtime that starts the worker).
3. The Codex adapter's capability probe must pass for: stable inference, session
   continuity, steering, output validation, and Action Review compatibility
   (the criteria in `docs/RUNTIME_ADAPTERS.md`). Only then does
   `resolveInference()` select it as the Session Actor.

Until those checks pass, Param keeps Codex as a task/runtime adapter target and
runs the Session Actor on the fallback path above.
