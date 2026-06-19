import { z } from "zod";

export const secretRefSchema = z.union([
  z.object({ env: z.string().min(1) }),
  z.object({ file: z.string().min(1) }),
  z.object({
    provider: z.literal("future_secret_manager"),
    key: z.string().min(1),
  }),
]);

export type SecretRef = z.infer<typeof secretRefSchema>;

const secretOrStringSchema = z.union([z.string().min(1), secretRefSchema]);

const trustedUserScopeSchema = z.union([
  z.object({ scope: z.literal("global") }),
  z.object({ scope: z.literal("server_admin") }),
  z.object({
    scope: z.literal("chat"),
    platform: z.string().min(1),
    chatId: secretOrStringSchema,
    topicId: secretOrStringSchema.optional(),
  }),
  z.object({
    scope: z.literal("project"),
    projectId: z.string().min(1),
  }),
]);

const harnessSandboxSchema = z.object({
  provider: z.enum(["vercel", "just-bash"]),
  runtime: z.string().min(1).optional(),
  ports: z.array(z.number().int().positive()).optional(),
});

const harnessRuntimeSchema = z.object({
  enabled: z.boolean(),
  adapter: z.literal("ai-sdk-harness"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  workspacesDir: z.string().min(1),
  startupCheck: z.enum(["require", "warn", "skip"]).optional(),
  harness: z.object({
    packageName: z.string().min(1),
    sandbox: harnessSandboxSchema,
  }),
});

const directCliRuntimeSchema = z.object({
  enabled: z.boolean(),
  adapter: z.literal("direct-cli").optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  workspacesDir: z.string().min(1),
  startupCheck: z.enum(["require", "warn", "skip"]).optional(),
  harness: z.never().optional(),
});

const cliRuntimeSchema = z.union([harnessRuntimeSchema, directCliRuntimeSchema]);

const hostPlatformSchema = z.enum(["linux", "macos", "windows"]);
const appEnvironmentSchema = z.enum([
  "development",
  "test",
  "staging",
  "production",
]);
const databaseProviderSchema = z.enum([
  "local",
  "neon",
  "supabase",
  "custom",
]);
const databaseProvisioningModeSchema = z.enum([
  "local-postgres",
  "existing-url",
  "managed-neon",
  "managed-supabase",
]);
const databaseSslSchema = z.union([z.boolean(), z.literal("require")]);
const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

export const paramConfigSchema = z.object({
  app: z.object({
    name: z.string().min(1),
    environment: appEnvironmentSchema,
    timezone: z.string().min(1),
    publicBaseUrl: z.string().url().optional(),
  }),
  paths: z.object({
    dataDir: z.string().min(1),
    logDir: z.string().min(1),
    workspaceDir: z.string().min(1),
    artifactDir: z.string().min(1),
  }),
  database: z.object({
    url: secretRefSchema,
    provider: databaseProviderSchema,
    provisioningMode: databaseProvisioningModeSchema,
    ssl: databaseSslSchema,
    pool: z.object({
      max: z.number().int().positive(),
      idleTimeoutSeconds: z.number().int().positive(),
    }),
    local: z
      .object({
        serviceName: z.string().min(1),
        database: z.string().min(1),
        user: z.string().min(1),
        extensions: z.array(z.string().min(1)),
        backupDir: z.string().min(1),
      })
      .optional(),
  }),
  channels: z.object({
    telegram: z
      .object({
        enabled: z.boolean(),
        defaultAccountId: z.string().min(1),
        access: z.object({
          rejectUnauthorized: z.boolean(),
          unauthorizedBehavior: z.enum(["ignore", "audit_minimal"]),
          allowedPrivateUserIds: z.array(secretOrStringSchema),
          allowedGroupChatIds: z.array(secretOrStringSchema),
          allowedTopicIds: z.array(
            z.object({
              chatId: secretOrStringSchema,
              topicId: secretOrStringSchema,
            }),
          ),
        }),
        accounts: z.record(
          z.string().min(1),
          z.object({
            botToken: secretRefSchema,
            mode: z.enum(["polling", "webhook"]),
            allowedUpdates: z.array(z.string().min(1)).optional(),
          }),
        ),
      })
      .optional(),
  }),
  trustedUsers: z.array(
    z.object({
      label: z.string().min(1),
      platform: z.string().min(1),
      platformUserId: secretOrStringSchema,
      scopes: z.array(trustedUserScopeSchema).min(1),
    }),
  ),
  actor: z.object({
    defaultRuntime: z.enum(["codex", "opencode", "antigravity"]),
    maxVisibleMessagesPerRun: z.number().int().positive(),
    requireDoneOutput: z.boolean(),
    styleGuard: z.object({
      enabled: z.boolean(),
      rewriteOnFailure: z.boolean(),
    }),
  }),
  prompts: z.object({
    voiceProfile: z.string().min(1),
    contractSet: z.string().min(1),
  }),
  runtimes: z
    .object({
      codex: cliRuntimeSchema.optional(),
      opencode: cliRuntimeSchema.optional(),
      antigravity: cliRuntimeSchema.optional(),
    })
    .superRefine((runtimes, ctx) => {
      for (const runtimeName of ["opencode", "antigravity"] as const) {
        if (runtimes[runtimeName]?.adapter === "ai-sdk-harness") {
          ctx.addIssue({
            code: "custom",
            path: [runtimeName, "adapter"],
            message:
              "AI SDK harness adapter mode is only enabled for Codex right now",
          });
        }
      }
    }),
  actionReview: z.object({
    trustedApprovalRequiredForConsequentialActions: z.boolean(),
    approvalTimeoutMinutes: z.number().int().positive(),
    safeAutoRunTools: z.array(z.string()),
  }),
  observability: z.object({
    logs: z.object({
      level: logLevelSchema,
      format: z.literal("json"),
      artifactLargeLogs: z.boolean(),
    }),
  }),
  installer: z.object({
    hosts: z.object({
      supported: z.array(hostPlatformSchema).min(1),
      serviceManagers: z.object({
        linux: z.enum(["systemd", "manual"]),
        macos: z.enum(["launchd", "manual"]),
        windows: z.enum(["windows-service", "manual"]),
      }),
    }),
    serviceUser: z.string().min(1),
    db: databaseProvisioningModeSchema,
    owner: z
      .object({
        promptOnFirstInstall: z.boolean(),
        telegramUserIdEnv: z.literal("PARAM_OWNER_TELEGRAM_USER_ID"),
      })
      .optional(),
    runtimes: z
      .object({
        interactiveChecklist: z.boolean(),
        defaultSelected: z.array(z.enum(["codex", "opencode", "antigravity"])),
        installIfMissing: z.boolean(),
        allowSkipCodex: z.boolean().optional(),
      })
      .optional(),
  }),
});

export type ParamConfig = z.infer<typeof paramConfigSchema>;

export type ParamConfigOverride = DeepPartial<ParamConfig>;

type DeepPartial<T> = {
  [K in keyof T]?: DeepPartialValue<T[K]>;
};

type DeepPartialValue<T> = T extends Array<infer U>
  ? Array<DeepPartialValue<U>>
  : T extends object
    ? DeepPartial<T>
    : T;
