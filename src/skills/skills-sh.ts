import type { SkillSummary } from "./registry";

/**
 * skills.sh is Param's default skills ecosystem. It is treated as an EXTERNAL
 * TOOL (`bunx skills ...`) rather than a trusted internal dependency.
 *
 * This client never spawns real processes itself. All process/network effects
 * go through an injected runner port so the behavior is fully testable with a
 * fake runner.
 */
export interface SkillsShRunner {
  search(query: string): Promise<SkillSummary[]>;
  install(slug: string): Promise<{ localPath: string; contentHash: string }>;
}

/**
 * Installing (or updating) a skill changes Param's behavior, so it is a
 * state-changing action that requires Action Review before it takes effect.
 */
export type SkillInstallResult = {
  slug: string;
  localPath: string;
  contentHash: string;
  /** Installs are reviewed actions; the caller must route this through review. */
  requiresReview: true;
};

export class SkillsShClient {
  constructor(private readonly runner: SkillsShRunner) {}

  /** Discovery returns metadata only; no skill content is loaded here. */
  search(query: string): Promise<SkillSummary[]> {
    return this.runner.search(query);
  }

  /** Delegate to the runner and flag the result as a reviewed action. */
  async install(slug: string): Promise<SkillInstallResult> {
    const result = await this.runner.install(slug);
    return {
      slug,
      localPath: result.localPath,
      contentHash: result.contentHash,
      requiresReview: true,
    };
  }
}
