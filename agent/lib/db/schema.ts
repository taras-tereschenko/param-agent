import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const paramProfiles = pgTable("param_profiles", {
  principalId: text("principal_id").primaryKey(),
  displayName: text("display_name"),
  timezone: text("timezone").notNull().default("UTC"),
  locale: text("locale").notNull().default("en"),
  bio: text("bio").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const paramMemories = pgTable(
  "param_memories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalId: text("principal_id")
      .notNull()
      .references(() => paramProfiles.principalId, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("principal"),
    category: text("category").notNull(),
    content: text("content").notNull(),
    source: text("source").notNull().default("agent"),
    confidence: real("confidence").notNull().default(1),
    provenance: text("provenance"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex("param_memories_principal_scope_category_unique").on(
      table.principalId,
      table.scope,
      table.category,
    ),
    index("param_memories_principal_scope_idx").on(table.principalId, table.scope),
    index("param_memories_principal_category_idx").on(table.principalId, table.category),
  ],
);

export type ParamProfile = typeof paramProfiles.$inferSelect;
export type NewParamProfile = typeof paramProfiles.$inferInsert;
export type ParamMemory = typeof paramMemories.$inferSelect;
export type NewParamMemory = typeof paramMemories.$inferInsert;
