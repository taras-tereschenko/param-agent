import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getTableName } from "drizzle-orm";
import { describe, expect, test } from "bun:test";

import baseConfig from "../param.config";
import { resolveSecretRef } from "../src/config/secrets";
import { resolveDatabaseUrl } from "../src/db/client";
import { jobStatusSchema } from "../src/db/repositories";
import { schema } from "../src/db/schema";

describe("database config", () => {
  test("resolves database url from env secret refs", () => {
    expect(
      resolveDatabaseUrl(baseConfig, {
        DATABASE_URL: "postgresql://param:secret@127.0.0.1:5432/param",
      }),
    ).toBe("postgresql://param:secret@127.0.0.1:5432/param");
  });

  test("resolves file secret refs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "param-db-test-"));
    const secretPath = join(dir, "database-url");

    try {
      await writeFile(secretPath, "postgresql://param:file@127.0.0.1/param\n");

      expect(resolveSecretRef({ file: secretPath })).toBe(
        "postgresql://param:file@127.0.0.1/param",
      );
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});

describe("database schema", () => {
  test("exports the core runtime tables", () => {
    expect(getTableName(schema.users)).toBe("users");
    expect(getTableName(schema.userAccounts)).toBe("user_accounts");
    expect(getTableName(schema.trustedUsers)).toBe("trusted_users");
    expect(getTableName(schema.channelAccounts)).toBe("channel_accounts");
    expect(getTableName(schema.platformChats)).toBe("platform_chats");
    expect(getTableName(schema.sessions)).toBe("sessions");
    expect(getTableName(schema.sessionParticipants)).toBe(
      "session_participants",
    );
    expect(getTableName(schema.events)).toBe("events");
    expect(getTableName(schema.rawPayloads)).toBe("raw_payloads");
    expect(getTableName(schema.actorRuns)).toBe("actor_runs");
    expect(getTableName(schema.actorOutputs)).toBe("actor_outputs");
    expect(getTableName(schema.deliveryAttempts)).toBe("delivery_attempts");
    expect(getTableName(schema.jobs)).toBe("jobs");
    expect(getTableName(schema.auditLog)).toBe("audit_log");
  });

  test("validates stable job statuses", () => {
    expect(jobStatusSchema.parse("queued")).toBe("queued");
    expect(jobStatusSchema.safeParse("thinking").success).toBe(false);
  });
});
