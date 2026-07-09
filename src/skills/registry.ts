import { notFoundError, validationError } from "../shared/errors";

/**
 * Skills are PROCEDURAL KNOWLEDGE, not permissions. The registry is the source
 * of truth for what is installed, enabled, and trusted. Enabling a skill never
 * grants tool access; the Tool Registry + Action Review still gate every call.
 */
export type SkillTrustStatus = "untrusted" | "trusted" | "blocked";

export type SkillSummary = {
  slug: string;
  name: string;
  source: string;
  trustStatus: SkillTrustStatus;
  enabled: boolean;
  summary?: string;
};

/**
 * In-memory registry of installed skills. Callers receive copies so the
 * registry's invariants (notably "enabled implies trusted") cannot be bypassed
 * by mutating a returned object.
 */
export class SkillRegistry {
  private readonly skills = new Map<string, SkillSummary>();

  /** Install/replace a skill's metadata. */
  register(skill: SkillSummary): void {
    this.skills.set(skill.slug, { ...skill });
  }

  get(slug: string): SkillSummary | undefined {
    const found = this.skills.get(slug);
    return found ? { ...found } : undefined;
  }

  list(): SkillSummary[] {
    return [...this.skills.values()].map((skill) => ({ ...skill }));
  }

  /** Only skills that are both trusted and enabled may reach actor context. */
  listEnabledTrusted(): SkillSummary[] {
    return this.list().filter(
      (skill) => skill.enabled && skill.trustStatus === "trusted",
    );
  }

  /**
   * Change a skill's trust status. Losing trust also disables the skill so the
   * "enabled implies trusted" invariant always holds.
   */
  setTrust(slug: string, status: SkillTrustStatus): SkillSummary {
    const skill = this.require(slug);
    skill.trustStatus = status;
    if (status !== "trusted") {
      skill.enabled = false;
    }
    return { ...skill };
  }

  /** A skill can only be enabled once it is trusted. */
  enable(slug: string): SkillSummary {
    const skill = this.require(slug);
    if (skill.trustStatus !== "trusted") {
      throw validationError(
        `cannot enable skill "${slug}" while trust status is "${skill.trustStatus}"`,
        { slug, trustStatus: skill.trustStatus },
      );
    }
    skill.enabled = true;
    return { ...skill };
  }

  disable(slug: string): SkillSummary {
    const skill = this.require(slug);
    skill.enabled = false;
    return { ...skill };
  }

  private require(slug: string): SkillSummary {
    const skill = this.skills.get(slug);
    if (!skill) {
      throw notFoundError(`skill not found: ${slug}`, { slug });
    }
    return skill;
  }
}
