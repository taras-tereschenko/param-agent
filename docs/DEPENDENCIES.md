# Param Agent Dependencies

This file records the default package choices for Param.

It is an ADR, not a lockfile. Exact versions belong in `package.json` and
the generated `bun.lock`.

Do not hand-write the lockfile. Implementation should install packages with Bun,
let the package manager resolve real versions from the registry, then commit the
generated `bun.lock`.

## Goal

Choose enough packages to start building without turning Param into a pile of
frameworks.

Rules:

- prefer Bun built-ins when they are enough
- add a dependency only when it removes real complexity
- use established ecosystem packages for established problems
- keep package choices replaceable behind Param's own module boundaries
- pin real versions in the lockfile, not in docs

## Default Runtime Stack

```text
Bun
TypeScript
Hono
Drizzle
local Postgres + pgvector
Vercel Chat SDK
Codex CLI runtime adapter
MCP TypeScript SDK
Zod
```

## Core Packages

Runtime and TypeScript:

```text
bun
typescript
@types/bun
```

Bun is the runtime, package manager, script runner, and test runner. TypeScript
is still installed so `tsc --noEmit` can typecheck the repo.

HTTP:

```text
hono
```

Hono owns routing, middleware, health routes, webhook routes, Mini App routes,
and operator routes. Bun can serve HTTP directly, but Hono keeps the app
surface clearer.

Config and validation:

```text
zod
```

Zod validates env, config files, internal events, actor output, tool inputs,
UI specs, and Action Review proposals.

Do not install `dotenv` by default. Bun reads `.env` files automatically.

Database:

```text
drizzle-orm
drizzle-kit
```

Use Drizzle with Bun SQL through `drizzle-orm/bun-sql`.

Bun SQL is built into Bun, so it is not added as a package.

Reasons:

- Drizzle is the chosen typed query and migration layer.
- Bun SQL is native to the chosen runtime.
- Drizzle officially supports Bun SQL.
- Local Postgres with pgvector covers events, jobs, memory, vectors, audit,
  and Chat SDK state before adding Redis or a separate vector DB.
- Direct `pg` / `@types/pg` is not a core Param app dependency.

Chat channels:

```text
chat
@chat-adapter/telegram
@chat-adapter/state-pg
```

`chat` is the Chat SDK entrypoint. `@chat-adapter/telegram` is the first
channel adapter. `@chat-adapter/state-pg` stores Chat SDK state in Postgres so
Param does not need Redis by default.

The Chat SDK Postgres state adapter is built on `pg` internally. Param should
not use that fact as a reason to choose `pg` for its own database module.

Add direct `pg` / `@types/pg` only if Param needs to pass a custom `pg.Pool`
into Chat SDK state or integrate with a package that requires node-postgres.

AI SDK:

```text
ai
```

AI SDK is optional in the default build.

Param starts with Codex CLI through the Codex runtime adapter because that uses
the existing Codex subscription path. Param should not make direct paid API
model calls by default.

Add `ai` only when an implemented feature needs AI SDK primitives, such as
structured object generation, telemetry helpers, generated UI data, eval
helpers, or an adapter experiment.

AI SDK is not Param's runtime adapter system. Codex, OpenCode, Antigravity, and
other CLIs still sit behind `src/runtimes/` adapters because Param must control
process lifecycle, workspaces, steering, output buffering, artifacts, Action
Review, and audit.

AI SDK community providers for Codex CLI or OpenCode can be tested inside those
runtime adapters, but they do not replace the adapters.

Optional provider packages are added only when enabled in config:

```text
@ai-sdk/openai
@ai-sdk/anthropic
@ai-sdk/google
```

These provider packages are for a future explicit API-backed runtime. They are
not bootstrap dependencies.

Optional community provider packages are added only after adapter tests prove
they preserve Param's runtime contract:

```text
ai-sdk-provider-codex-cli
ai-sdk-provider-opencode-sdk
```

There is no default AI SDK provider dependency for Antigravity CLI.

Do not hardcode model ids in docs. Model choices belong in typed config.

## CLI Runtime Installs

Codex, OpenCode, and Antigravity are host CLI runtimes, not normal app package
dependencies.

Installer prompt UI:

```text
@clack/prompts
```

Use `@clack/prompts` for terminal prompts such as checkboxes, confirms,
selects, and text inputs.

Use `@inquirer/prompts` only as a fallback if a specific installer prompt
becomes awkward in Clack.

Use built-in `util.parseArgs` for CLI flags. Do not add a full CLI framework
until the installer grows real subcommands.

Ink is not part of the default installer dependency set. Add `ink` and `react`
only if Param grows a richer operator/admin TUI. Do not use Ink just to ask
checkbox questions during setup.

The Linux installer should offer a checklist to install/check them:

```text
[x] Codex CLI
[x] OpenCode CLI
[x] Antigravity CLI
```

Exact install commands are implementation/runtime-installer data and must be
verified against current official docs before use. Do not hide CLI installs
inside `bun install`.

MCP:

```text
@modelcontextprotocol/sdk
```

Use the official TypeScript SDK for MCP clients and any local MCP servers Param
owns.

## Telegram Mini App UI Packages

Mini App UI is optional until a generated UI feature needs it.

When enabled:

```text
react
react-dom
@ai-sdk/react
lucide-react
```

Development types:

```text
@types/react
@types/react-dom
```

shadcn/ui is not treated as a black-box runtime framework. Its CLI writes
components into the repo, and those components become Param-owned source code.

Use shadcn through `bunx` when adding or updating components:

```text
bunx shadcn@latest
```

Packages pulled by shadcn components, such as `class-variance-authority`,
`clsx`, `tailwind-merge`, and Radix packages, are allowed when the component
actually needs them.

## Observability Packages

Start with Param-owned structured JSON logs.

Add OpenTelemetry packages when Param exports traces or metrics outside local
logs:

```text
@opentelemetry/api
@opentelemetry/sdk-node
@opentelemetry/exporter-trace-otlp-http
@opentelemetry/exporter-metrics-otlp-http
```

Do not add a logging framework until the local logger becomes painful.

## Test Packages

Default tests use Bun:

```text
bun test
```

Do not add Jest or Vitest by default.

Playwright is optional for browser task agents and Mini App UI verification:

```text
playwright
```

## Skills

skills.sh is used as an external tool, not a normal runtime dependency.

Use it through reviewed install/update actions and local scripts, for example:

```text
bunx skills
```

Skills remain procedural knowledge. They do not grant permissions.

## Deferred By Default

These are valid tools, but not part of the default stack:

```text
redis
temporal
effect
prisma
next
express
fastify
langchain
llamaindex
dedicated vector databases
dotenv
```

Reasons:

- Redis is unnecessary until Postgres-backed locks/queues/state hit real
  contention.
- Temporal is unnecessary until Param outgrows Postgres jobs and recovery
  workers.
- Effect is unnecessary until code structure needs a full effect system.
- Prisma conflicts with the Drizzle decision.
- Next.js is unnecessary because Param does not ship a standalone web app.
- Express/Fastify duplicate Hono.
- LangChain/LlamaIndex would become another orchestration layer.
- Dedicated vector DBs are unnecessary while pgvector is enough.
- `dotenv` duplicates Bun's automatic `.env` loading.

## Initial Package Scripts

Target scripts for the first scaffold:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "dev:app": "bun --watch src/app/main.ts",
    "dev:worker": "bun --watch src/worker/main.ts",
    "start:app": "bun run src/app/main.ts",
    "start:worker": "bun run src/worker/main.ts",
    "db:generate": "bunx drizzle-kit generate",
    "db:migrate": "bunx drizzle-kit migrate",
    "doctor": "bun run scripts/doctor.ts",
    "install:linux": "bun run scripts/install-linux.ts"
  }
}
```

## Compatibility Rule

If a useful package fails under Bun:

1. isolate it behind the relevant Param adapter
2. try a small compatibility fix
3. run it as a child process if needed
4. replace it only if the integration remains fragile

Do not let one package force the whole system away from Bun without a new ADR.
