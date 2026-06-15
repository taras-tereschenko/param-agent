import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";

import { loadConfig } from "../config/load";
import { resolveSecretRef, type SecretEnv } from "../config/secrets";
import type { ParamConfig } from "../config/schema";
import { schema } from "./schema";

export function resolveDatabaseUrl(
  config: ParamConfig,
  env: SecretEnv = Bun.env,
): string {
  return resolveSecretRef(config.database.url, env);
}

export function createDbClient(config: ParamConfig) {
  const client = new SQL({
    url: resolveDatabaseUrl(config),
    max: config.database.pool.max,
    idleTimeout: config.database.pool.idleTimeoutSeconds,
    tls: config.database.ssl,
  });

  return drizzle(client, { schema });
}

export type ParamDb = ReturnType<typeof createDbClient>;

let singletonDb: ParamDb | undefined;

export async function getDb(): Promise<ParamDb> {
  singletonDb ??= createDbClient(await loadConfig());
  return singletonDb;
}
