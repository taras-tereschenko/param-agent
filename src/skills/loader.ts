import type { SkillSummary } from "./registry";

/**
 * Progressive loading of procedural knowledge into the actor prompt.
 *
 * The actor first sees only relevant skill summaries. Full `content` is loaded
 * lazily and only when a skill has been explicitly selected for use, which
 * keeps context small and avoids loading unused skill files.
 */
export type LoadedSkill = {
  slug: string;
  summary: string;
  content?: string;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * Rank installed skills by simple keyword overlap between the query and each
 * skill's name + summary. Only enabled+trusted skills are considered (this is
 * the progressive-loading gate: summaries first, never disabled skills), and at
 * most `max` skills are returned, highest overlap first.
 */
export function selectRelevantSkills(
  query: string,
  skills: SkillSummary[],
  max: number,
): SkillSummary[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0 || max <= 0) {
    return [];
  }

  const ranked = skills
    .filter((skill) => skill.enabled && skill.trustStatus === "trusted")
    .map((skill) => {
      const skillTokens = new Set(
        tokenize(`${skill.name} ${skill.summary ?? ""}`),
      );
      let overlap = 0;
      for (const token of skillTokens) {
        if (queryTokens.has(token)) {
          overlap += 1;
        }
      }
      return { skill, overlap };
    })
    .filter((candidate) => candidate.overlap > 0);

  // Stable sort keeps registration order for equal-overlap skills.
  ranked.sort((a, b) => b.overlap - a.overlap);

  return ranked.slice(0, max).map((candidate) => candidate.skill);
}

/**
 * Render selected skills for the actor prompt. Summaries are shown by default;
 * full `content` is only included when it has been explicitly loaded.
 */
export function buildSkillContextText(loaded: LoadedSkill[]): string {
  if (loaded.length === 0) {
    return "";
  }

  const lines = loaded.map((skill) => {
    const header = `- ${skill.slug}: ${skill.summary}`;
    if (skill.content !== undefined && skill.content.length > 0) {
      return `${header}\n${skill.content}`;
    }
    return header;
  });

  return [
    "Relevant skills (procedural knowledge, summaries first):",
    ...lines,
  ].join("\n");
}
