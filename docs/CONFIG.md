# Param Agent Configuration

This file describes Param's configuration model.

Config should be easy to edit, strongly typed, and safe to validate at startup.

## Configuration Principles

- Non-secret config lives in TypeScript files.
- Secrets live in `.env`, secret references, or a future host secret manager.
- `.env.example` documents every expected environment variable.
- Runtime config is validated with Zod before the app starts.
- Trusted users are configuration/security state, not memory.
- Config changes that affect permissions, tools, trusted users, server behavior,
  schedules, secrets, or memory policy require Action Review.
- The actor can read safe config summaries, but it cannot silently mutate trusted
  config.
- Config should be modular so channels, runtimes, tools, memory, scheduler, and
  UI can be swapped independently.

## File Layout

Recommended files:

```text
param.config.ts
  committed safe defaults and shared non-secret config

param.config.local.ts
  per-instance non-secret overrides, ignored by git

.env
  secrets and machine-specific values, ignored by git

.env.example
  safe placeholders and documentation for expected env values

src/config/schema.ts
  Zod schemas and inferred TypeScript types

src/config/load.ts
  config loading, layering, validation, and redaction
```

Layering order:

```text
defaults
  -> param.config.ts
  -> param.config.local.ts
  -> .env and process.env
  -> trusted admin overrides from database
```

The effective config should be logged in redacted form at startup.

`param.config.ts` is committed and contains safe shared defaults. It should not
contain secrets. People can fork it or change it when they intentionally want to
change the shared defaults.

`param.config.local.ts` is the main file a person edits for their own running
instance. It overrides the committed defaults and should be ignored by git.

Setup should create `param.config.local.ts` when it is missing. The generated
file should be mostly empty, with comments explaining that it exists for local
non-secret overrides. Setup must never overwrite an existing
`param.config.local.ts`.

Good uses for `param.config.local.ts`:

- local filesystem paths
- enabled or disabled runtimes
- preferred default runtime
- personal scheduler limits
- channel mode such as Telegram polling vs webhook
- non-secret labels, ids, and feature flags

Bad uses for `param.config.local.ts`:

- raw bot tokens
- database URLs with passwords
- model API keys
- secrets that should live in `.env`

This makes the repo shareable while still giving users a real config override:
`param.config.ts` describes the default product setup, while
`param.config.local.ts` describes one person's running instance.

Starter `param.config.local.ts`:

```ts
// Local Param config overrides.
//
// This file is ignored by git.
// Put per-instance non-secret settings here.
//
// Good examples:
// - local paths
// - enabled runtimes
// - scheduler limits
// - Telegram polling/webhook mode
// - non-secret labels and feature flags
//
// Do not put secrets here.
// Put bot tokens, database URLs, and API keys in .env.

import type { ParamConfigOverride } from "./src/config/schema";

export default {
  // Example:
  // app: {
  //   timezone: "Asia/Tashkent",
  // },
} satisfies ParamConfigOverride;
```

## Secret References

TypeScript config should refer to secrets by name, not contain secret values.

Example:

```ts
const secret = { env: "TELEGRAM_BOT_TOKEN" };
```

Secret reference shape:

```ts
type SecretRef =
  | { env: string }
  | { file: string }
  | { provider: "future_secret_manager"; key: string };
```

The actor should never receive raw secret values.

## Top-Level Config Shape

Target shape:

```ts
export type ParamConfig = {
  app: AppConfig;
  paths: PathsConfig;
  database: DatabaseConfig;
  channels: ChannelsConfig;
  trustedUsers: TrustedUserConfig[];
  actor: ActorConfig;
  prompts: PromptConfig;
  runtimes: RuntimesConfig;
  taskAgents: TaskAgentsConfig;
  skills: SkillsConfig;
  tools: ToolsConfig;
  actionReview: ActionReviewConfig;
  security: SecurityConfig;
  memory: MemoryConfig;
  scheduler: SchedulerConfig;
  ui: UiConfig;
  observability: ObservabilityConfig;
  installer: InstallerConfig;
};
```

## Example `param.config.ts`

```ts
import { defineParamConfig } from "./src/config/define";

export default defineParamConfig({
  app: {
    name: "Param",
    environment: "production",
    timezone: "Asia/Tashkent",
    publicBaseUrl: undefined,
  },

  paths: {
    dataDir: "/var/lib/param-agent",
    logDir: "/var/log/param-agent",
    workspaceDir: "/var/lib/param-agent/workspaces",
    artifactDir: "/var/lib/param-agent/artifacts",
  },

  database: {
    url: { env: "DATABASE_URL" },
    provider: "local",
    provisioningMode: "local-postgres",
    ssl: false,
    pool: {
      max: 10,
      idleTimeoutSeconds: 30,
    },
    local: {
      serviceName: "postgresql",
      database: "param",
      user: "param",
      extensions: ["pgcrypto", "vector"],
      backupDir: "/var/lib/param-agent/backups/postgres",
    },
  },

  channels: {
    telegram: {
      enabled: true,
      defaultAccountId: "main",
      access: {
        rejectUnauthorized: true,
        unauthorizedBehavior: "ignore",
        allowedPrivateUserIds: [{ env: "PARAM_OWNER_TELEGRAM_USER_ID" }],
        allowedGroupChatIds: [],
        allowedTopicIds: [],
      },
      accounts: {
        main: {
          botToken: { env: "TELEGRAM_BOT_TOKEN" },
          mode: "polling",
          allowedUpdates: [
            "message",
            "edited_message",
            "message_reaction",
            "callback_query",
          ],
        },
      },
    },
  },

  trustedUsers: [
    {
      label: "owner",
      platform: "telegram",
      platformUserId: { env: "PARAM_OWNER_TELEGRAM_USER_ID" },
      scopes: [{ scope: "global" }, { scope: "server_admin" }],
    },
  ],

  actor: {
    defaultRuntime: "codex",
    maxVisibleMessagesPerRun: 6,
    requireDoneOutput: true,
    styleGuard: {
      enabled: true,
      rewriteOnFailure: true,
    },
  },

  prompts: {
    voiceProfile: "param_friend_v1",
    contractSet: "default_v1",
  },

  runtimes: {
    codex: {
      enabled: true,
      command: "codex",
      workspacesDir: "/var/lib/param-agent/runtime-workspaces/codex",
      startupCheck: "require",
    },
    opencode: {
      enabled: true,
      command: "opencode",
      workspacesDir: "/var/lib/param-agent/runtime-workspaces/opencode",
      startupCheck: "warn",
    },
    antigravity: {
      enabled: true,
      command: "antigravity",
      workspacesDir: "/var/lib/param-agent/runtime-workspaces/antigravity",
      startupCheck: "warn",
    },
  },

  taskAgents: {
    enabled: true,
    maxConcurrentPerSession: 3,
    maxConcurrentGlobal: 12,
    types: {
      research: {
        runtime: "codex",
        defaultTools: ["web.search", "fs.read_scoped"],
        defaultBudget: {
          timeoutSeconds: 900,
          maxCostUsd: 2,
        },
      },
      coding: {
        runtime: "codex",
        defaultTools: ["fs.read_scoped", "git.status"],
        defaultBudget: {
          timeoutSeconds: 1800,
          maxCostUsd: 5,
        },
      },
    },
  },

  skills: {
    enabled: true,
    provider: "skills.sh",
    installCommand: {
      runner: "bunx",
      packageName: "skills",
    },
    paths: {
      installedDir: "/var/lib/param-agent/skills/installed",
      cacheDir: "/var/lib/param-agent/skills/cache",
    },
    telemetry: {
      disableSkillsCliTelemetry: true,
    },
    discovery: {
      useApi: true,
      preferCurated: true,
      hideDuplicates: true,
      maxResults: 20,
    },
    trust: {
      requireReviewBeforeInstall: true,
      requireReviewBeforeEnable: true,
      blockFailedAudits: true,
      allowUnauditedSkills: "manual_review",
    },
    context: {
      maxSkillSummaries: 8,
      maxFullSkillsPerRun: 2,
      maxSkillBytesPerRun: 24000,
    },
  },

  tools: {
    safeAutoRun: [
      "system.health.read",
      "logs.tail",
      "fs.read_scoped",
      "git.status",
    ],
    mcp: {
      enabled: true,
      servers: {},
    },
    execution: {
      defaultTimeoutSeconds: 120,
      maxOutputBytes: 64000,
      maxConcurrentToolCalls: 4,
    },
  },

  actionReview: {
    mode: "auto_review_then_manual",
    approvalTimeoutMinutes: 60,
    trustedApprovalRequiredForConsequentialActions: true,
  },

  security: {
    redaction: {
      enabled: true,
      redactSecretsInLogs: true,
      redactSecretsInActorContext: true,
    },
    network: {
      requireHttpsForRemoteAuth: true,
      blockPrivateIpRangesForServerFetch: true,
      blockCloudMetadataIp: true,
      validateRedirectTargets: true,
    },
    mcp: {
      requireReviewForServerChanges: true,
      requireNamespacing: true,
      storeConfigHash: true,
    },
    miniApps: {
      initDataMaxAgeSeconds: 86400,
      callbackTtlSeconds: 900,
      rejectReplay: true,
    },
    rateLimits: {
      maxActorRunsPerSessionPerMinute: 4,
      maxToolCallsPerRun: 12,
      maxConcurrentTaskAgentsGlobal: 12,
    },
  },

  memory: {
    enabled: true,
    embeddingModel: "text-embedding-3-small",
    embeddingDimensions: 1536,
    review: {
      afterQuietMinutes: 20,
      scheduledEvery: "6h",
    },
  },

  scheduler: {
    enabled: true,
    ambientTurns: {
      enabled: true,
      defaultActiveHours: {
        start: "10:00",
        end: "23:30",
        timezone: "chat",
      },
      defaultCooldown: {
        perSessionMinutes: 90,
        perIntentMinutes: 240,
      },
      defaultLimits: {
        maxProactiveMessagesPerDay: 4,
      },
    },
  },

  ui: {
    renderer: {
      maxSpecBytes: 32000,
      allowedSchemas: [
        "param.card",
        "param.form",
        "param.action_list",
        "param.status",
        "param.media_picker",
        "param.settings",
        "param.mini_app",
        "param.theme_patch",
      ],
      callbackTtlSeconds: 900,
      maxCallbacksPerSurface: 12,
      webRenderer: "vercel-ai-sdk-ui",
      componentSystem: "shadcn-ui",
      allowThemePatches: true,
      allowedThemeScopes: ["surface", "session", "profile", "global"],
      allowedThemeTokens: [
        "background",
        "foreground",
        "card",
        "card-foreground",
        "popover",
        "popover-foreground",
        "primary",
        "primary-foreground",
        "secondary",
        "secondary-foreground",
        "muted",
        "muted-foreground",
        "accent",
        "accent-foreground",
        "destructive",
        "border",
        "input",
        "ring",
        "chart-1",
        "chart-2",
        "chart-3",
        "chart-4",
        "chart-5",
      ],
      maxThemePatchBytes: 8000,
    },
    miniApps: {
      enabled: true,
      requirePublicHttps: true,
      publicBaseUrl: { env: "PARAM_PUBLIC_BASE_URL" },
      defaultTtlSeconds: 1800,
    },
  },

  observability: {
    logLevel: "info",
    auditEnabled: true,
    redactSecrets: true,
    traces: {
      enabled: true,
      retainDays: 7,
      recordInputs: false,
      recordOutputs: false,
      exporter: "file",
    },
    metrics: {
      enabled: true,
      exporter: "none",
    },
    decisionRecords: {
      enabled: true,
      retainDays: 90,
    },
    logs: {
      format: "json",
      retainDays: 14,
      artifactLargeLogs: true,
    },
  },

  installer: {
    hosts: {
      supported: ["linux", "macos", "windows"],
      serviceManagers: {
        linux: "systemd",
        macos: "launchd",
        windows: "windows-service",
      },
    },
    serviceUser: "param",
    runtimes: {
      interactiveChecklist: true,
      defaultSelected: ["codex", "opencode", "antigravity"],
      installIfMissing: true,
    },
  },
});
```

This example describes shape only. Exact defaults can change during
implementation.

## App Config

```ts
type AppConfig = {
  name: string;
  environment: "development" | "staging" | "production";
  timezone: string;
  publicBaseUrl?: string;
};
```

`publicBaseUrl` is required only for public surfaces:

- Telegram webhook mode
- Mini Apps
- OAuth callbacks
- public artifact links
- public operator endpoints, if ever enabled

Telegram polling does not require `publicBaseUrl`.

## Paths Config

```ts
type PathsConfig = {
  dataDir: string;
  logDir: string;
  workspaceDir: string;
  artifactDir: string;
  configDir?: string;
};
```

Validation:

- paths must be absolute on production
- installer creates missing directories
- app must fail loudly if required paths are not readable/writable

## Database Config

```ts
type DatabaseConfig = {
  url: SecretRef;
  provider: "local" | "neon" | "supabase" | "custom";
  provisioningMode: "local-postgres" | "existing-url" | "managed-neon" | "managed-supabase";
  ssl: boolean | "require" | "prefer";
  pool?: {
    max?: number;
    idleTimeoutSeconds?: number;
  };
  local?: {
    serviceName: string;
    database: string;
    user: string;
    extensions: string[];
    backupDir: string;
  };
};
```

The database must support generated UUIDs and pgvector.

Default VPS install:

```text
provider: local
provisioningMode: local-postgres
extensions: ["pgcrypto", "vector"]
```

Managed Postgres remains supported by setting `DATABASE_URL` and using
`provisioningMode: existing-url`, `managed-neon`, or `managed-supabase`.

## Channels Config

Detailed channel behavior lives in `docs/CHANNELS.md`.

Telegram-specific behavior lives in `docs/channels/TELEGRAM.md`.

```ts
type ChannelsConfig = {
  telegram?: TelegramChannelConfig;
};

type TelegramChannelConfig = {
  enabled: boolean;
  defaultAccountId: string;
  access: TelegramAccessConfig;
  accounts: Record<string, TelegramAccountConfig>;
};

type TelegramAccessConfig = {
  rejectUnauthorized: boolean;
  unauthorizedBehavior: "ignore" | "audit_minimal";
  allowedPrivateUserIds: (string | SecretRef)[];
  allowedGroupChatIds: (string | SecretRef)[];
  allowedTopicIds?: {
    chatId: string | SecretRef;
    topicId: string | SecretRef;
  }[];
};

type TelegramAccountConfig = {
  botToken: SecretRef;
  mode: "polling" | "webhook";
  polling?: {
    timeoutSeconds?: number;
    limit?: number;
    lockTtlSeconds?: number;
  };
  webhook?: {
    url?: string;
    secretToken: SecretRef;
    dropPendingUpdates?: boolean;
  };
  allowedUpdates?: string[];
  delivery?: {
    retryAttempts?: number;
    retryBackoffSeconds?: number[];
    splitLongMessages?: boolean;
  };
  files?: {
    downloadEnabled?: boolean;
    maxDownloadBytes?: number;
  };
  reactions?: {
    enabled: boolean;
    conservativeFallback?: string[];
  };
};
```

Default:

```text
Telegram uses polling on the VPS.
Telegram rejects disallowed users/groups/topics by config.
```

Webhook mode requires public HTTPS and a secret token.

Access rules decide who can talk to Param at all.

`allowedPrivateUserIds` is for DMs. It lists Telegram user ids that may open a
private chat with Param.

`allowedGroupChatIds` is for groups. It lists Telegram group/supergroup chat ids
where Param may participate. Everyone in an allowed group can talk with Param in
that group session.

`allowedTopicIds` optionally narrows allowed group access to specific forum
topics.

Allowed access is not trust. Trusted users decide who can approve consequential
actions. A user can be allowed to chat without being a trusted approver, and a
group can be allowed without making everyone in that group trusted.

Future channel configs should follow the same pattern:

```ts
type ChannelConfig = {
  enabled: boolean;
  accounts: Record<string, unknown>;
  capabilities?: ChannelCapabilityConfig;
};
```

## Trusted Users Config

```ts
type TrustedUserConfig = {
  label: string;
  platform: "telegram" | string;
  platformUserId: string | SecretRef;
  scopes: TrustedUserScopeConfig[];
};

type TrustScope = "global" | "chat" | "project" | "server_admin";

type TrustedUserScopeConfig =
  | { scope: "global" }
  | { scope: "server_admin" }
  | {
      scope: "chat";
      platform: "telegram" | string;
      chatId: string | SecretRef;
      topicId?: string | SecretRef;
    }
  | {
      scope: "project";
      projectId: string;
    };
```

Rules:

- at least one global/server admin trusted user is required in production
- the first VPS install configures one owner trusted user from
  `PARAM_OWNER_TELEGRAM_USER_ID`
- the owner is also the default allowed DM user
- trusted users can approve consequential actions
- trusted users are not memory
- chat-scoped trust must identify the exact chat, and optionally topic, where
  the user can approve
- project-scoped trust must identify the exact project
- changing trusted users requires Action Review or direct admin access

## Actor Config

```ts
type ActorConfig = {
  defaultRuntime: "codex" | "opencode" | "antigravity";
  maxVisibleMessagesPerRun: number;
  requireDoneOutput: boolean;
  styleGuard: {
    enabled: boolean;
    rewriteOnFailure: boolean;
  };
};
```

Actor config controls runtime defaults and structural behavior. It does not
replace prompt contracts.

## Prompt Config

```ts
type PromptConfig = {
  voiceProfile: string;
  contractSet: string;
  profiles?: Record<string, PromptProfileConfig>;
};

type PromptProfileConfig = {
  description: string;
  layers: string[];
};
```

Initial profiles:

```text
param_friend_v1
default_v1
```

Prompt text should be stored in versioned prompt modules, not scattered through
business logic.

Prompt contract details live in `docs/PROMPTS.md`.

## Skills Config

Detailed skills behavior lives in `docs/SKILLS.md`.

```ts
type SkillsConfig = {
  enabled: boolean;
  provider: "skills.sh";
  installCommand: {
    runner: "npx" | "bunx";
    packageName: "skills";
  };
  paths: {
    installedDir: string;
    cacheDir: string;
  };
  telemetry: {
    disableSkillsCliTelemetry: boolean;
  };
  discovery: {
    useApi: boolean;
    preferCurated: boolean;
    hideDuplicates: boolean;
    maxResults: number;
  };
  trust: {
    requireReviewBeforeInstall: boolean;
    requireReviewBeforeEnable: boolean;
    blockFailedAudits: boolean;
    allowUnauditedSkills: "never" | "manual_review" | "allowed_restricted";
  };
  context: {
    maxSkillSummaries: number;
    maxFullSkillsPerRun: number;
    maxSkillBytesPerRun: number;
  };
};
```

Skills can require tools, but they do not grant tools. Tool access still goes
through Tool Registry and Action Review.

## Runtime Config

Detailed runtime-adapter behavior lives in `docs/RUNTIME_ADAPTERS.md`.

```ts
type RuntimesConfig = {
  codex?: CliRuntimeConfig;
  opencode?: CliRuntimeConfig;
  antigravity?: CliRuntimeConfig;
  image?: ImageRuntimeConfig;
  browser?: BrowserRuntimeConfig;
};

type CliRuntimeConfig = {
  enabled: boolean;
  command: string;
  args?: string[];
  workspacesDir: string;
  startupCheck?: "require" | "warn" | "skip";
  env?: Record<string, string | SecretRef>;
  personalityInjection?: {
    enabled: boolean;
    method: "custom_instructions" | "project_file" | "runtime_config" | "adapter";
  };
  liveSteering?: "native" | "followup_run" | "unsupported";
  outputMode?: "buffered" | "checkpointed_stream";
  toolMode?: "disabled" | "adapter_intercepted" | "runtime_native_safe";
  capabilities?: Partial<RuntimeAdapterCapabilitiesConfig>;
  workspacePolicy?: RuntimeWorkspacePolicyConfig;
  defaultBudget?: RuntimeBudget;
};

type RuntimeBudget = {
  timeoutSeconds?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  maxToolCalls?: number;
};

type RuntimeAdapterCapabilitiesConfig = {
  supportsLiveSteering: boolean;
  supportsCancel: boolean;
  supportsCheckpointRefresh: boolean;
  supportsToolInterception: boolean;
  supportsOutputBuffering: boolean;
  supportsArtifacts: boolean;
  supportsUsage: boolean;
};

type RuntimeWorkspacePolicyConfig = {
  mode: "read_only" | "scoped_write" | "full_workspace";
  cleanupAfterDays?: number;
};

type ImageRuntimeConfig = {
  enabled: boolean;
  provider: "openai" | string;
  env?: Record<string, string | SecretRef>;
  outputMode?: "buffered";
  capabilities?: Partial<RuntimeAdapterCapabilitiesConfig>;
  defaultBudget?: RuntimeBudget;
  artifactRetentionDays?: number;
};

type BrowserRuntimeConfig = {
  enabled: boolean;
  command: string;
  args?: string[];
  profilesDir?: string;
  headless: boolean;
  env?: Record<string, string | SecretRef>;
  outputMode?: "buffered" | "checkpointed_stream";
  capabilities?: Partial<RuntimeAdapterCapabilitiesConfig>;
  defaultBudget?: RuntimeBudget & {
    maxBrowserSteps?: number;
  };
};
```

`enabled` means Param is allowed to use that runtime when its adapter is
implemented and the runtime is available.

`startupCheck` controls boot behavior:

```text
require
  fail startup when the runtime is enabled but unavailable

warn
  log/report missing runtime, but keep Param online

skip
  do not check runtime availability at startup
```

Default target posture:

- Codex is enabled and required because it is the first/default main actor
  runtime.
- OpenCode is enabled but warning-only at startup until its adapter is ready.
- Antigravity is enabled but warning-only at startup until its adapter is ready.

Runtime config should not grant tool power directly. Tool access still goes
through Tool Registry and Action Review.

## Task Agents Config

Detailed task-agent behavior lives in `docs/TASK_AGENTS.md`.

```ts
type TaskAgentsConfig = {
  enabled: boolean;
  maxConcurrentPerSession: number;
  maxConcurrentGlobal: number;
  types: Record<string, TaskAgentTypeConfig>;
};

type TaskAgentTypeConfig = {
  runtime: keyof RuntimesConfig | string;
  fallbackRuntime?: keyof RuntimesConfig | string;
  defaultTools: string[];
  defaultBudget: RuntimeBudget & {
    maxToolCalls?: number;
  };
  workspace?: {
    root?: string;
    cleanupAfterDays?: number;
  };
  artifacts?: {
    retentionDays?: number;
  };
};
```

Task-agent config selects runtimes and defaults. It does not bypass Tool
Registry, Action Review, or runtime adapter policy.

## Tools Config

Detailed tool behavior lives in `docs/TOOLS.md`.

```ts
type ToolsConfig = {
  safeAutoRun: string[];
  disabled?: string[];
  policies?: Record<string, ToolPolicyConfig>;
  mcp?: McpToolsConfig;
  execution?: ToolExecutionConfig;
};

type ToolPolicyConfig = {
  riskLevel:
    | "safe_read"
    | "private_read"
    | "write"
    | "external_send"
    | "server"
    | "security"
    | "spend"
    | "destructive";
  approval: "safe_auto_run" | "auto_review" | "manual" | "blocked";
  scopes?: string[];
};

type McpToolsConfig = {
  enabled: boolean;
  servers: Record<string, McpServerConfig>;
};

type McpServerConfig = {
  enabled: boolean;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string | SecretRef>;
  trust: "unreviewed" | "trusted" | "restricted" | "blocked";
};

type ToolExecutionConfig = {
  defaultTimeoutSeconds: number;
  maxOutputBytes: number;
  maxConcurrentToolCalls: number;
};
```

The safe auto-run list should stay small.

Examples:

```text
system.health.read
logs.tail
fs.read_scoped
git.status
```

## Action Review Config

```ts
type ActionReviewConfig = {
  mode: "manual" | "auto_review_then_manual";
  approvalTimeoutMinutes: number;
  trustedApprovalRequiredForConsequentialActions: boolean;
  riskLevels?: Record<string, ActionRiskConfig>;
};

type ActionRiskConfig = {
  requiresTrustedApproval: boolean;
  allowAutoReview: boolean;
};
```

Consequential actions require trusted-user approval, even when requested from a
group chat.

Detailed Action Review behavior lives in `docs/ACTION_REVIEW.md`.

## Security Config

Detailed security behavior lives in `docs/SECURITY.md`.

```ts
type SecurityConfig = {
  redaction: {
    enabled: boolean;
    redactSecretsInLogs: boolean;
    redactSecretsInActorContext: boolean;
  };
  network: {
    requireHttpsForRemoteAuth: boolean;
    blockPrivateIpRangesForServerFetch: boolean;
    blockCloudMetadataIp: boolean;
    validateRedirectTargets: boolean;
  };
  mcp: {
    requireReviewForServerChanges: boolean;
    requireNamespacing: boolean;
    storeConfigHash: boolean;
  };
  miniApps: {
    initDataMaxAgeSeconds: number;
    callbackTtlSeconds: number;
    rejectReplay: boolean;
  };
  rateLimits: {
    maxActorRunsPerSessionPerMinute: number;
    maxToolCallsPerRun: number;
    maxConcurrentTaskAgentsGlobal: number;
  };
};
```

## Memory Config

```ts
type MemoryConfig = {
  enabled: boolean;
  embeddingModel: string;
  embeddingDimensions: number;
  review: {
    afterQuietMinutes: number;
    scheduledEvery: string;
  };
  retrieval?: {
    maxRecords?: number;
    semanticWeight?: number;
    keywordWeight?: number;
    recencyWeight?: number;
  };
  retention?: {
    defaultExpiresAfterDays?: number;
  };
};
```

`embeddingDimensions` must match the database vector column dimension.

Detailed memory behavior lives in `docs/MEMORY.md`.

## Scheduler Config

Detailed scheduler behavior lives in `docs/SCHEDULER.md`.

```ts
type SchedulerConfig = {
  enabled: boolean;
  ambientTurns: {
    enabled: boolean;
    defaultActiveHours: ActiveHoursConfig;
    defaultCooldown: AmbientCooldownConfig;
    defaultLimits: AmbientLimitsConfig;
  };
};

type ActiveHoursConfig = {
  start: string;
  end: string;
  timezone: "chat" | "server" | string;
};

type AmbientCooldownConfig = {
  perSessionMinutes: number;
  perIntentMinutes: number;
};

type AmbientLimitsConfig = {
  maxProactiveMessagesPerDay: number;
};
```

Recurring chat-proactive schedules require trusted-user approval before they
become active.

## UI Config

Detailed UI behavior lives in `docs/UI.md`.

```ts
type UiConfig = {
  renderer: {
    maxSpecBytes: number;
    allowedSchemas: string[];
    callbackTtlSeconds: number;
    maxCallbacksPerSurface: number;
    webRenderer: "vercel-ai-sdk-ui";
    componentSystem: "shadcn-ui";
    allowThemePatches: boolean;
    allowedThemeScopes: ("surface" | "session" | "profile" | "global")[];
    allowedThemeTokens: ShadcnThemeToken[];
    maxThemePatchBytes: number;
  };
  miniApps: {
    enabled: boolean;
    requirePublicHttps: boolean;
    publicBaseUrl?: string | { env: string };
    defaultTtlSeconds: number;
  };
};
```

Mini Apps require public HTTPS. Telegram polling does not.

`ShadcnThemeToken` is the approved semantic token union documented in
`docs/UI.md`.

## Eval Runner Config

Detailed test and eval behavior lives in `docs/EVALS.md`.

Eval runner config should be separate from production config so sharing Param
does not accidentally share private chat fixtures.

```ts
type EvalRunnerConfig = {
  scenariosDir: string;
  reportsDir: string;
  redactReports: boolean;
  modelSmoke?: {
    enabled: boolean;
    maxScenarios: number;
  };
  graders?: {
    modelBased: boolean;
    requireDeterministicSafetyAssertions: boolean;
  };
};
```

## Observability Config

Detailed observability behavior lives in `docs/OBSERVABILITY.md`.

```ts
type ObservabilityConfig = {
  logLevel: "debug" | "info" | "warn" | "error";
  auditEnabled: boolean;
  redactSecrets: boolean;
  traces: {
    enabled: boolean;
    retainDays: number;
    recordInputs: boolean;
    recordOutputs: boolean;
    exporter: "none" | "otlp" | "file";
  };
  metrics: {
    enabled: boolean;
    exporter: "none" | "prometheus" | "otlp";
  };
  decisionRecords: {
    enabled: boolean;
    retainDays?: number;
  };
  logs: {
    format: "json";
    retainDays?: number;
    artifactLargeLogs: boolean;
  };
};
```

Startup should print a redacted config summary.

## Installer Config

Detailed operations behavior lives in `docs/OPS.md`.
Installer script layout lives in `docs/PROJECT_STRUCTURE.md`.

```ts
type InstallerConfig = {
  hosts: {
    supported: Array<"linux" | "macos" | "windows">;
    serviceManagers: {
      linux: "systemd" | "manual";
      macos: "launchd" | "manual";
      windows: "windows-service" | "manual";
    };
  };
  serviceUser: string;
  db: "local-postgres" | "existing-url" | "managed-neon" | "managed-supabase";
  dryRunDefault?: boolean;
  owner?: OwnerInstallerConfig;
  runtimes?: RuntimeInstallerConfig;
  services?: {
    app?: string;
    worker?: string;
  };
  localPostgres?: {
    installPackages: boolean;
    tuneForSmallVps: boolean;
    sharedBuffers?: string;
    maxConnections?: number;
  };
  backups?: {
    enabled: boolean;
    schedule: string;
    retentionCount: number;
    offsite?: boolean;
  };
};

type OwnerInstallerConfig = {
  promptOnFirstInstall: boolean;
  telegramUserIdEnv: "PARAM_OWNER_TELEGRAM_USER_ID";
};

type RuntimeInstallerConfig = {
  interactiveChecklist: boolean;
  defaultSelected: ("codex" | "opencode" | "antigravity")[];
  installIfMissing: boolean;
  allowSkipCodex?: boolean;
};
```

The installer uses this as intent, but it must still confirm before overwriting
existing service files or config.

On first install, setup must collect the owner Telegram user id unless
`PARAM_OWNER_TELEGRAM_USER_ID` is already provided. The owner id seeds the first
trusted user and the default allowed DM user. Allowed groups are configured
separately in `param.config.local.ts`.

When `interactiveChecklist` is enabled and runtime flags are not provided, setup
shows checkboxes for:

```text
[x] Codex CLI
[x] OpenCode CLI
[x] Antigravity CLI
```

The checklist controls installation/checking of host CLI runtimes. It does not
grant tool permissions. Runtime tool access still goes through Runtime
Adapters, Tool Registry, and Action Review.

## `.env.example`

Target contents:

```dotenv
# Database
DATABASE_PROVIDER=local
DATABASE_PROVISIONING_MODE=local-postgres
DATABASE_URL=postgresql://param:replace_me@127.0.0.1:5432/param

# Telegram
TELEGRAM_BOT_TOKEN=replace_me

# First trusted owner and default allowed DM user.
# Setup should ask for this on first VPS install.
PARAM_OWNER_TELEGRAM_USER_ID=replace_me

# Optional runtime overrides
CODEX_HOME=
OPENCODE_CONFIG_DIR=
ANTIGRAVITY_CONFIG_DIR=

# Optional public URL, required for webhooks / Mini Apps / OAuth callbacks
PARAM_PUBLIC_BASE_URL=

# Optional webhook secret, only required in webhook mode
TELEGRAM_WEBHOOK_SECRET=replace_me

# Optional admin/internal access
TAILSCALE_AUTH_KEY=

# App
PARAM_ENV=production
PARAM_LOG_LEVEL=info
```

`.env.example` must never contain real secrets.

The installer may create `.env` from `.env.example` when missing, but it must
never overwrite an existing `.env`.

## Validation Rules

Startup validation must fail when:

- `DATABASE_URL` is missing or malformed
- Telegram is enabled and no bot token is configured
- Telegram is enabled and access rules allow no users, groups, or topics
- production owner Telegram user id is missing on first install
- production has no trusted user with `global` or `server_admin` scope
- webhook mode is enabled without public URL or webhook secret
- Mini Apps are enabled without public URL
- embedding dimensions do not match database schema
- required runtime workspace paths are missing or unwritable
- action review is disabled for consequential actions
- scheduler ambient turns are enabled without approval policy
- log redaction is disabled in production

Warnings are allowed when:

- optional target runtimes are unavailable or warning-only at startup
- public URL is missing while no public features need it
- ambient turns are disabled
- memory retention is unset

## Redacted Config View

Admin/debug views may show config, but secrets must be redacted.

Example:

```json
{
  "database": {
    "url": "env:DATABASE_URL"
  },
  "channels": {
    "telegram": {
      "accounts": {
        "main": {
          "botToken": "env:TELEGRAM_BOT_TOKEN"
        }
      }
    }
  }
}
```

Never print resolved secret values in logs, actor context, traces, or approval
messages.

## Config Ownership

Ownership boundaries:

- Config loader resolves files, env, overrides, and redaction.
- Zod schemas validate structure and security invariants.
- Modules receive only the config slice they need.
- Actor receives only safe summaries.
- Action Review gates trusted config changes.
- Database stores trusted admin overrides and audit history.
