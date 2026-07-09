import type { ParamDb } from "../db/client";
import {
  checkDatabaseConnection,
  listMissingDatabaseExtensions,
} from "../db/extensions";
import { processStatus } from "./self-management";

export type HealthCheck = {
  name: string;
  status: "ok" | "warn" | "error";
  detail: string;
};

export type HealthSnapshot = {
  ok: boolean;
  checkedAt: string;
  process: ReturnType<typeof processStatus>;
  checks: HealthCheck[];
};

/** Aggregate a health snapshot: process info + database connectivity/extensions. */
export async function checkSystemHealth(
  db?: ParamDb,
): Promise<HealthSnapshot> {
  const checks: HealthCheck[] = [];

  if (db) {
    try {
      await checkDatabaseConnection(db);
      checks.push({ name: "database", status: "ok", detail: "connected" });
      const missing = await listMissingDatabaseExtensions(db);
      checks.push(
        missing.length === 0
          ? { name: "extensions", status: "ok", detail: "pgcrypto, vector" }
          : {
              name: "extensions",
              status: "error",
              detail: `missing: ${missing.join(", ")}`,
            },
      );
    } catch (error) {
      checks.push({
        name: "database",
        status: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    checks.push({
      name: "database",
      status: "warn",
      detail: "no database client provided",
    });
  }

  const ok = checks.every((check) => check.status === "ok");
  return {
    ok,
    checkedAt: new Date().toISOString(),
    process: processStatus(),
    checks,
  };
}
