import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const needsDatabase = process.argv.some(arg =>
  ["migrate", "push", "pull", "studio", "check"].includes(arg),
);

if (needsDatabase && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for this Drizzle command");
}

export default defineConfig({
  schema: "./agent/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://param:param@localhost:5432/param",
  },
});
