import { defineParamConfig } from "./src/config/define";

export default defineParamConfig({
  app: {
    name: "Param",
    environment: "development",
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
      extensions: ["vector"],
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
  actionReview: {
    trustedApprovalRequiredForConsequentialActions: true,
    approvalTimeoutMinutes: 60,
    safeAutoRunTools: [],
  },
  observability: {
    logs: {
      format: "json",
      artifactLargeLogs: true,
    },
  },
  installer: {
    systemd: true,
    serviceUser: "param",
    db: "local-postgres",
    owner: {
      promptOnFirstInstall: true,
      telegramUserIdEnv: "PARAM_OWNER_TELEGRAM_USER_ID",
    },
    runtimes: {
      interactiveChecklist: true,
      defaultSelected: ["codex", "opencode", "antigravity"],
      installIfMissing: true,
    },
  },
});

