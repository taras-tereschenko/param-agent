import { and, eq } from "drizzle-orm";

import type { ParamDb } from "../client";
import { skills } from "../schema";
import type { SkillSummary, SkillTrustStatus } from "../../skills/registry";

/**
 * Skills data access. Skills are procedural knowledge; only trusted+enabled
 * skills may reach the actor prompt (enforced here in SQL AND again by
 * selectRelevantSkills). `enabled` is stored as text ("true"/"false").
 */

type SkillRow = {
  slug: string;
  name: string;
  source: string;
  trustStatus: string;
  enabled: string;
  metadata: unknown;
};

/** PURE row -> SkillSummary. Summary comes from metadata.summary, else name. */
export function toSkillSummary(row: SkillRow): SkillSummary {
  const meta = (row.metadata ?? {}) as { summary?: unknown };
  const summary =
    typeof meta.summary === "string" && meta.summary.length > 0
      ? meta.summary
      : row.name;
  return {
    slug: row.slug,
    name: row.name,
    source: row.source,
    trustStatus: row.trustStatus as SkillTrustStatus,
    enabled: row.enabled === "true",
    summary,
  };
}

export type UpsertSkillInput = {
  slug: string;
  name: string;
  source?: string;
  summary?: string;
  trustStatus?: SkillTrustStatus;
  enabled?: boolean;
};

export const skillsRepository = {
  /** Trusted + enabled skills, shaped for the actor's progressive loader. */
  async listEnabledTrustedSkills(db: ParamDb): Promise<SkillSummary[]> {
    const rows = await db
      .select({
        slug: skills.slug,
        name: skills.name,
        source: skills.source,
        trustStatus: skills.trustStatus,
        enabled: skills.enabled,
        metadata: skills.metadata,
      })
      .from(skills)
      .where(
        and(eq(skills.trustStatus, "trusted"), eq(skills.enabled, "true")),
      );
    return rows.map(toSkillSummary);
  },

  /** All skills (for the admin CLI listing). */
  async listAll(db: ParamDb): Promise<SkillSummary[]> {
    const rows = await db
      .select({
        slug: skills.slug,
        name: skills.name,
        source: skills.source,
        trustStatus: skills.trustStatus,
        enabled: skills.enabled,
        metadata: skills.metadata,
      })
      .from(skills);
    return rows.map(toSkillSummary);
  },

  /**
   * Insert or update a skill by (source, slug). Enabling requires trust — the
   * "enabled implies trusted" invariant is enforced here too.
   */
  async upsertSkill(db: ParamDb, input: UpsertSkillInput): Promise<void> {
    const source = input.source ?? "local";
    const trustStatus = input.trustStatus ?? "untrusted";
    const enabled = input.enabled === true && trustStatus === "trusted";
    const metadata = input.summary ? { summary: input.summary } : {};
    await db
      .insert(skills)
      .values({
        source,
        slug: input.slug,
        name: input.name,
        trustStatus,
        enabled: enabled ? "true" : "false",
        metadata,
        installedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [skills.source, skills.slug],
        set: {
          name: input.name,
          trustStatus,
          enabled: enabled ? "true" : "false",
          metadata,
          updatedAt: new Date(),
        },
      });
  },

  /**
   * Set trust. Losing trust also disables the skill (enabled implies trusted).
   */
  async setTrust(
    db: ParamDb,
    slug: string,
    trustStatus: SkillTrustStatus,
  ): Promise<void> {
    await db
      .update(skills)
      .set({
        trustStatus,
        reviewedAt: new Date(),
        updatedAt: new Date(),
        ...(trustStatus === "trusted" ? {} : { enabled: "false" }),
      })
      .where(eq(skills.slug, slug));
  },

  /** Enable/disable a skill. Enabling only takes effect when trusted. */
  async setEnabled(db: ParamDb, slug: string, enabled: boolean): Promise<void> {
    if (!enabled) {
      await db
        .update(skills)
        .set({ enabled: "false", updatedAt: new Date() })
        .where(eq(skills.slug, slug));
      return;
    }
    // Only enable trusted skills (enabled implies trusted).
    await db
      .update(skills)
      .set({ enabled: "true", updatedAt: new Date() })
      .where(and(eq(skills.slug, slug), eq(skills.trustStatus, "trusted")));
  },
};
