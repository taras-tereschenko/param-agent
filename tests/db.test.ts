import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getTableName } from "drizzle-orm";
import { describe, expect, test } from "bun:test";

import baseConfig from "../param.config";
import { resolveSecretRef } from "../src/config/secrets";
import { databaseTlsEnabled, resolveDatabaseUrl } from "../src/db/client";
import {
  jobStatusSchema,
  validateEventJsonColumns,
  validateRawPayloadJsonColumns,
} from "../src/db/repositories";
import {
  coreDatabaseConstraints,
  coreDatabaseIndexes,
  coreDatabaseTables,
} from "../src/db/extensions";
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

  test("maps database ssl modes to Bun SQL tls settings", () => {
    expect(databaseTlsEnabled(false)).toBe(false);
    expect(databaseTlsEnabled(true)).toBe(true);
    expect(databaseTlsEnabled("require")).toBe(true);
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

  test("tracks core tables required by db:check", () => {
    expect(coreDatabaseTables).toContain("sessions");
    expect(coreDatabaseTables).toContain("events");
    expect(coreDatabaseTables).toContain("jobs");
    expect(coreDatabaseTables).toContain("audit_log");
  });

  test("tracks core indexes and constraints required by db:check", () => {
    expect(coreDatabaseIndexes).toContain("events_dedupe_key_unique");
    expect(coreDatabaseIndexes).toContain("jobs_idempotency_key_unique");
    expect(coreDatabaseConstraints).toContain("jobs_status_check");
    expect(coreDatabaseConstraints).toContain("events_direction_check");
  });

  test("validates stable job statuses", () => {
    expect(jobStatusSchema.parse("queued")).toBe("queued");
    expect(jobStatusSchema.safeParse("thinking").success).toBe(false);
  });

  test("validates event repository JSONB contracts", () => {
    expect(() =>
      validateEventJsonColumns({
        source: { kind: "user" },
        platform: { platform: "telegram" },
        payload: { text: "yo" },
        raw: { provider: "telegram" },
      }),
    ).not.toThrow();

    expect(() =>
      validateEventJsonColumns({
        source: ["not", "an", "object"] as unknown as Record<string, unknown>,
        platform: null,
        payload: {},
        raw: null,
      }),
    ).toThrow();
  });

  test("validates raw payload JSONB contracts", () => {
    expect(() =>
      validateRawPayloadJsonColumns({ json: { updateId: "123" } }),
    ).not.toThrow();
    expect(() =>
      validateRawPayloadJsonColumns({
        json: [] as unknown as Record<string, unknown>,
      }),
    ).toThrow();
  });
});
