import { describe, expect, test } from "bun:test";
import baseConfig from "../param.config";
import { configOverrideFromEnv, mergeConfig } from "../src/config/load";
import { redactConfig } from "../src/config/redact";
import { paramConfigSchema } from "../src/config/schema";
import {
  validateRequiredConfigSecretRefs,
  validateSecretRefs,
} from "../src/config/secrets";

describe("config schema", () => {
  test("rejects invalid app environment", () => {
    const result = paramConfigSchema.safeParse({
      app: {
        name: "Param",
        environment: "space",
        timezone: "Asia/Tashkent",
      },
    });

    expect(result.success).toBe(false);
  });

  test("local runtime overrides keep base runtime defaults", () => {
    const merged = mergeConfig(baseConfig, {
      actor: {
        defaultRuntime: "codex",
      },
      runtimes: {
        codex: {
          enabled: false,
        },
        opencode: {
          enabled: true,
        },
      },
    });

    const result = paramConfigSchema.safeParse(merged);

    expect(result.success).toBe(true);
    expect(merged.runtimes.codex?.enabled).toBe(false);
    expect(merged.runtimes.codex?.adapter).toBe("direct-cli");
    expect(merged.runtimes.codex?.command).toBe("codex");
    expect(merged.runtimes.codex).not.toHaveProperty("harness");
    expect(merged.runtimes.codex?.workspacesDir).toContain("codex");
    expect(merged.runtimes.opencode?.enabled).toBe(true);
    expect(merged.runtimes.opencode?.adapter).toBe("direct-cli");
    expect(merged.runtimes.opencode?.command).toBe("opencode");
  });

  test("requires harness settings when Codex uses harness adapter mode", () => {
    const result = paramConfigSchema.safeParse({
      ...baseConfig,
      runtimes: {
        ...baseConfig.runtimes,
        codex: {
          enabled: true,
          adapter: "ai-sdk-harness",
          command: "codex",
          workspacesDir: "/tmp/param-codex",
          startupCheck: "require",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test("rejects harness adapter mode for OpenCode until it is enabled", () => {
    const result = paramConfigSchema.safeParse({
      ...baseConfig,
      runtimes: {
        ...baseConfig.runtimes,
        opencode: {
          enabled: true,
          adapter: "ai-sdk-harness",
          command: "opencode",
          workspacesDir: "/tmp/param-opencode",
          startupCheck: "warn",
          harness: {
            packageName: "@ai-sdk/harness-opencode",
            sandbox: {
              provider: "vercel",
              ports: [4000],
            },
          },
        },
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
        "runtimes.opencode.adapter",
      );
    }
  });

  test("secret reference overrides replace the whole reference", () => {
    const merged = mergeConfig(baseConfig, {
      database: {
        url: {
          file: "/run/secrets/param-database-url",
        },
      },
    });

    const result = paramConfigSchema.safeParse(merged);

    expect(result.success).toBe(true);
    expect(merged.database.url).toEqual({
      file: "/run/secrets/param-database-url",
    });
  });

  test("redacts secret references in config summaries", () => {
    const redacted = redactConfig(baseConfig);

    expect(redacted.database.url).toEqual({ env: "env:<redacted>" });
    expect(
      redacted.channels.telegram?.accounts.main?.botToken,
    ).toEqual({ env: "env:<redacted>" });
    expect(redacted.trustedUsers[0]?.platformUserId).toEqual({
      env: "env:<redacted>",
    });
  });

  test("redacts file secret references in config summaries", () => {
    const redacted = redactConfig(
      mergeConfig(baseConfig, {
        database: {
          url: {
            file: "/run/secrets/param-database-url",
          },
        },
      }),
    );

    expect(redacted.database.url).toEqual({ file: "file:<redacted>" });
  });

  test("applies typed env overrides for machine-local settings", () => {
    const merged = mergeConfig(
      baseConfig,
      configOverrideFromEnv({
        PARAM_ENV: "production",
        PARAM_PUBLIC_BASE_URL: "https://param.example.com",
        DATABASE_PROVIDER: "neon",
        DATABASE_PROVISIONING_MODE: "managed-neon",
        DATABASE_SSL: "require",
        PARAM_LOG_LEVEL: "debug",
      }),
    );

    expect(merged.app.environment).toBe("production");
    expect(merged.app.publicBaseUrl).toBe("https://param.example.com");
    expect(merged.database.provider).toBe("neon");
    expect(merged.database.provisioningMode).toBe("managed-neon");
    expect(merged.database.ssl).toBe("require");
    expect(merged.observability.logs.level).toBe("debug");
    expect(paramConfigSchema.safeParse(merged).success).toBe(true);
  });

  test("reports unresolved secret refs with config paths", () => {
    const issues = validateSecretRefs(baseConfig, {});

    expect(issues.map((issue) => issue.path)).toContain("$.database.url");
    expect(issues.map((issue) => issue.path)).toContain(
      "$.channels.telegram.accounts.main.botToken",
    );
    expect(issues.map((issue) => issue.path)).toContain(
      "$.trustedUsers[0].platformUserId",
    );
  });

  test("doctor-style validation skips secrets for disabled channels", () => {
    const config = mergeConfig(baseConfig, {
      channels: {
        telegram: {
          enabled: false,
        },
      },
    });
    const issues = validateRequiredConfigSecretRefs(config, {
      DATABASE_URL: "postgresql://param:secret@127.0.0.1:5432/param",
      PARAM_OWNER_TELEGRAM_USER_ID: "123456789",
    });

    expect(issues).toEqual([]);
  });

  test("doctor-style validation rejects malformed database urls", () => {
    const issues = validateRequiredConfigSecretRefs(baseConfig, {
      DATABASE_URL: "not-a-url",
      TELEGRAM_BOT_TOKEN: "123456:token",
      PARAM_OWNER_TELEGRAM_USER_ID: "123456789",
    });

    expect(issues).toEqual([
      {
        path: "$.database.url",
        message: "DATABASE_URL must be a valid Postgres URL",
      },
    ]);
  });
});
