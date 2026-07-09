import { describe, expect, test } from "bun:test";

import {
  SkillRegistry,
  type SkillSummary,
} from "../../src/skills/registry";
import {
  buildSkillContextText,
  selectRelevantSkills,
} from "../../src/skills/loader";
import { canUseSkillInScope } from "../../src/skills/trust";
import {
  SkillsShClient,
  type SkillsShRunner,
} from "../../src/skills/skills-sh";

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    slug: "example",
    name: "Example Skill",
    source: "skills.sh",
    trustStatus: "untrusted",
    enabled: false,
    ...overrides,
  };
}

describe("SkillRegistry", () => {
  test("enable requires trusted status", () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill({ slug: "pdf", trustStatus: "untrusted" }));

    expect(() => registry.enable("pdf")).toThrow();
    expect(registry.get("pdf")?.enabled).toBe(false);

    registry.setTrust("pdf", "trusted");
    const enabled = registry.enable("pdf");
    expect(enabled.enabled).toBe(true);
    expect(registry.listEnabledTrusted().map((s) => s.slug)).toEqual(["pdf"]);
  });

  test("losing trust disables the skill", () => {
    const registry = new SkillRegistry();
    registry.register(
      makeSkill({ slug: "shell", trustStatus: "trusted", enabled: true }),
    );
    expect(registry.listEnabledTrusted()).toHaveLength(1);

    registry.setTrust("shell", "blocked");
    expect(registry.get("shell")?.enabled).toBe(false);
    expect(registry.listEnabledTrusted()).toHaveLength(0);
  });

  test("get/list return copies that cannot mutate the registry", () => {
    const registry = new SkillRegistry();
    registry.register(makeSkill({ slug: "x", trustStatus: "trusted" }));

    const copy = registry.get("x")!;
    copy.enabled = true;
    expect(registry.get("x")?.enabled).toBe(false);
  });

  test("unknown slug throws", () => {
    const registry = new SkillRegistry();
    expect(() => registry.enable("nope")).toThrow();
  });
});

describe("selectRelevantSkills", () => {
  const skills: SkillSummary[] = [
    makeSkill({
      slug: "pdf",
      name: "PDF handling",
      summary: "extract text and tables from pdf documents",
      trustStatus: "trusted",
      enabled: true,
    }),
    makeSkill({
      slug: "research",
      name: "Research workflows",
      summary: "gather sources and summarize documents",
      trustStatus: "trusted",
      enabled: true,
    }),
    makeSkill({
      slug: "deploy",
      name: "Deployment procedures",
      summary: "ship services to production",
      trustStatus: "trusted",
      enabled: true,
    }),
    // trusted but disabled -> excluded
    makeSkill({
      slug: "pdf-pro",
      name: "PDF pro tools",
      summary: "advanced pdf document editing",
      trustStatus: "trusted",
      enabled: false,
    }),
    // enabled but untrusted -> excluded
    makeSkill({
      slug: "pdf-shady",
      name: "PDF shady",
      summary: "pdf document tricks",
      trustStatus: "untrusted",
      enabled: true,
    }),
  ];

  test("ranks by keyword overlap and only returns enabled+trusted", () => {
    const result = selectRelevantSkills(
      "help me parse a pdf document",
      skills,
      5,
    );
    const slugs = result.map((s) => s.slug);

    // pdf (overlap: pdf, document) ranks above research (overlap: documents? no
    // -> "documents" != "document"; overlap only via none) -> pdf first.
    expect(slugs[0]).toBe("pdf");
    // disabled and untrusted pdf skills must be excluded even though relevant.
    expect(slugs).not.toContain("pdf-pro");
    expect(slugs).not.toContain("pdf-shady");
    // deploy has zero overlap and must be excluded.
    expect(slugs).not.toContain("deploy");
  });

  test("respects the max cap", () => {
    const result = selectRelevantSkills("pdf document research", skills, 1);
    expect(result).toHaveLength(1);
  });

  test("empty query yields nothing", () => {
    expect(selectRelevantSkills("", skills, 5)).toEqual([]);
  });
});

describe("buildSkillContextText", () => {
  test("renders summaries by default and content only when loaded", () => {
    const text = buildSkillContextText([
      { slug: "pdf", summary: "handle pdf files" },
      { slug: "research", summary: "research workflows", content: "step 1..." },
    ]);
    expect(text).toContain("- pdf: handle pdf files");
    expect(text).toContain("- research: research workflows");
    expect(text).toContain("step 1...");
  });

  test("empty list renders empty string", () => {
    expect(buildSkillContextText([])).toBe("");
  });
});

describe("canUseSkillInScope", () => {
  const trusted = makeSkill({
    slug: "gh",
    trustStatus: "trusted",
    enabled: true,
  });

  test("untrusted or disabled skills are never usable", () => {
    expect(
      canUseSkillInScope(makeSkill({ enabled: true }), { type: "dm" }, []),
    ).toBe(false);
    expect(
      canUseSkillInScope(
        makeSkill({ trustStatus: "trusted", enabled: false }),
        { type: "dm" },
        [],
      ),
    ).toBe(false);
  });

  test("no configured scopes means global availability", () => {
    expect(canUseSkillInScope(trusted, { type: "group", id: "-100" }, [])).toBe(
      true,
    );
  });

  test("matching enabled scope grants use; other scopes/modes do not", () => {
    const scopes = [
      { scopeType: "group", scopeId: "-100", mode: "enabled" },
      { scopeType: "dm", mode: "disabled" },
    ];
    expect(
      canUseSkillInScope(trusted, { type: "group", id: "-100" }, scopes),
    ).toBe(true);
    // wrong scope id
    expect(
      canUseSkillInScope(trusted, { type: "group", id: "-200" }, scopes),
    ).toBe(false);
    // matching type but mode disabled
    expect(canUseSkillInScope(trusted, { type: "dm" }, scopes)).toBe(false);
  });

  test("scope entry without id matches any id of that type", () => {
    const scopes = [{ scopeType: "group", mode: "enabled" }];
    expect(
      canUseSkillInScope(trusted, { type: "group", id: "anything" }, scopes),
    ).toBe(true);
  });
});

describe("SkillsShClient", () => {
  test("search delegates to the injected runner (metadata only)", async () => {
    const found: SkillSummary[] = [
      makeSkill({ slug: "vercel-labs", name: "Vercel Labs agent skills" }),
    ];
    const runner: SkillsShRunner = {
      search: async (query) => {
        expect(query).toBe("agent skills");
        return found;
      },
      install: async () => ({ localPath: "/x", contentHash: "h" }),
    };
    const client = new SkillsShClient(runner);
    const results = await client.search("agent skills");
    expect(results).toEqual(found);
  });

  test("install delegates and flags the result as a reviewed action", async () => {
    let installedSlug = "";
    const runner: SkillsShRunner = {
      search: async () => [],
      install: async (slug) => {
        installedSlug = slug;
        return { localPath: "/var/lib/param/skills/pdf", contentHash: "abc123" };
      },
    };
    const client = new SkillsShClient(runner);
    const result = await client.install("pdf");

    expect(installedSlug).toBe("pdf");
    expect(result).toEqual({
      slug: "pdf",
      localPath: "/var/lib/param/skills/pdf",
      contentHash: "abc123",
      requiresReview: true,
    });
  });
});
