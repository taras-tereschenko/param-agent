import { createDbClient } from "../src/db/client";
import {
  checkDatabaseConnection,
  listMissingCoreDatabaseConstraints,
  listMissingCoreDatabaseIndexes,
  listMissingDatabaseExtensions,
  listMissingCoreDatabaseTables,
  listMissingExtendedDatabaseTables,
} from "../src/db/extensions";
import { loadConfig } from "../src/config/load";
import type { ParamDb } from "../src/db/client";

async function main() {
  let db: ParamDb | undefined;

  try {
    const config = await loadConfig();
    db = createDbClient(config);

    await checkDatabaseConnection(db);

    const missingExtensions = await listMissingDatabaseExtensions(db);
    if (missingExtensions.length > 0) {
      throw new Error(
        `missing database extensions: ${missingExtensions.join(", ")}`,
      );
    }

    const missingTables = await listMissingCoreDatabaseTables(db);
    if (missingTables.length > 0) {
      throw new Error(
        `database has not been migrated; missing core tables: ${missingTables.join(", ")}`,
      );
    }

    const missingIndexes = await listMissingCoreDatabaseIndexes(db);
    if (missingIndexes.length > 0) {
      throw new Error(
        `database schema is incomplete; missing core indexes: ${missingIndexes.join(", ")}`,
      );
    }

    const missingConstraints = await listMissingCoreDatabaseConstraints(db);
    if (missingConstraints.length > 0) {
      throw new Error(
        `database schema is incomplete; missing core constraints: ${missingConstraints.join(", ")}`,
      );
    }

    const missingExtendedTables = await listMissingExtendedDatabaseTables(db);
    if (missingExtendedTables.length > 0) {
      throw new Error(
        `database schema is incomplete; missing extended tables: ${missingExtendedTables.join(", ")}`,
      );
    }

    console.log("database connection ok");
    console.log("database extensions ok");
    console.log("database schema ok");
  } catch (error) {
    console.error("database check failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await db?.$client.close();
  }
}

await main();
