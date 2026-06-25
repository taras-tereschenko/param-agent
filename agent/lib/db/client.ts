import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema.js";

export { schema };

export type ParamDb = ReturnType<typeof createDbClient>;

export function databaseUrl() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for Param database access");
  }

  return url;
}

export function createDbClient(url = databaseUrl()) {
  return drizzle(url, { schema });
}

let db: ParamDb | undefined;

export function getDb() {
  db ??= createDbClient();
  return db;
}
