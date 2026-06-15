import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // drizzle-kit generate only needs this shape; db:migrate owns real secret resolution.
    url:
      process.env.DATABASE_URL ??
      "postgresql://param:param@127.0.0.1:5432/param",
  },
});
