import { migrate } from "drizzle-orm/bun-sql/migrator";

import { createDbClient } from "../src/db/client";
import { ensureDatabaseExtensions } from "../src/db/extensions";
import { loadConfig } from "../src/config/load";
import type { ParamDb } from "../src/db/client";

const migrationsFolder = "./drizzle/migrations";

async function main() {
  let db: ParamDb | undefined;

  try {
    const config = await loadConfig();
    db = createDbClient(config);

    await ensureDatabaseExtensions(db);
    await migrate(db, { migrationsFolder });
    console.log("database migrations applied");
  } catch (error) {
    console.error("database migration failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await db?.$client.close();
  }
}

await main();
