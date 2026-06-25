import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../agent/lib/db/client.js";

async function run() {
  const db = getDb();

  try {
    await db.execute(sql`create extension if not exists pgcrypto`);
  } catch (error) {
    console.error(
      "failed to create required Postgres extension pgcrypto. Make sure DATABASE_URL uses a role allowed to create extensions.",
    );
    throw error;
  }

  try {
    await db.execute(sql`create extension if not exists vector`);
    console.log("optional Postgres extension is available: vector");
  } catch (error) {
    console.warn(
      "pgvector is not available yet. That is okay until vector memory tables are added, but semantic memory will need a Postgres server with pgvector.",
    );
    console.warn(error);
  }

  console.log("required Postgres extensions are available: pgcrypto");
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
