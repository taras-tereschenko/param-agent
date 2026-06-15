import { createDbClient } from "../src/db/client";
import {
  checkDatabaseConnection,
  listMissingDatabaseExtensions,
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

    console.log("database connection ok");
    console.log("database extensions ok");
  } catch (error) {
    console.error("database check failed");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await db?.$client.close();
  }
}

await main();
