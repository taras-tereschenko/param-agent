import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../agent/lib/db/client.js";

async function run() {
  const db = getDb();

  const result = await db.execute<{ extname: string }>(
    sql`select extname from pg_extension where extname in ('pgcrypto', 'vector') order by extname`,
  );

  const installed = new Set(result.rows.map(row => row.extname));
  if (!installed.has("pgcrypto")) {
    throw new Error("missing required Postgres extension: pgcrypto");
  }

  await db.execute(sql`select 1`);

  console.log("database connection ok");
  console.log("required extensions ok: pgcrypto");

  if (installed.has("vector")) {
    console.log("optional extensions ok: vector");
  } else {
    console.warn("optional extension missing: vector. semantic memory can be enabled after pgvector is installed.");
  }
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
