import { and, eq } from "drizzle-orm";

import type { ParamDb } from "../client";
import { skills } from "../schema";
import type { SkillSummary } from "../../skills/registry";

/**
 * Skills data access. Skills are procedural knowledge; only trusted+enabled
 * skills may reach the actor prompt (enforced here in SQL AND again by
 * selectRelevantSkills). `enabled` is stored as text ("true"/"false").
 */
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
      })
      .from(skills)
      .where(
        and(eq(skills.trustStatus, "trusted"), eq(skills.enabled, "true")),
      );

    return rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      source: row.source,
      trustStatus: "trusted",
      enabled: true,
      summary: row.name,
    }));
  },
};
