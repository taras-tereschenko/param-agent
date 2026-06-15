import { describe, expect, test } from "bun:test";
import baseConfig from "../param.config";
import { mergeConfig } from "../src/config/load";
import { redactConfig } from "../src/config/redact";
import { paramConfigSchema } from "../src/config/schema";

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
    expect(merged.runtimes.codex?.command).toBe("codex");
    expect(merged.runtimes.codex?.workspacesDir).toContain("codex");
    expect(merged.runtimes.opencode?.enabled).toBe(true);
    expect(merged.runtimes.opencode?.command).toBe("opencode");
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
});
