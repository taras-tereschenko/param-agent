import { parseArgs } from "node:util";

import { loadConfig } from "../src/config/load";
import { createDbClient, type ParamDb } from "../src/db/client";
import { skillsRepository } from "../src/db/repositories";
import type { SkillTrustStatus } from "../src/skills/registry";

/**
 * Skills admin CLI — populate/curate the skills table so trusted+enabled skills
 * reach the actor context (see src/worker/actor-invocation.ts). Skills are
 * procedural knowledge, NOT permissions: enabling a skill never grants tool
 * access; the Tool Registry + Action Review still gate every call.
 *
 *   bun run skills list
 *   bun run skills add <slug> <name> [--summary "..."] [--source local] \
 *                      [--trust trusted|untrusted|blocked] [--enable]
 *   bun run skills trust <slug> <trusted|untrusted|blocked>
 *   bun run skills enable <slug>
 *   bun run skills disable <slug>
 */

const USAGE = [
  "Usage:",
  "  bun run skills list",
  "  bun run skills add <slug> <name> [--summary <text>] [--source <s>] [--trust <status>] [--enable]",
  "  bun run skills trust <slug> <trusted|untrusted|blocked>",
  "  bun run skills enable <slug>",
  "  bun run skills disable <slug>",
].join("\n");

const TRUST_VALUES: SkillTrustStatus[] = ["trusted", "untrusted", "blocked"];

function isTrust(value: string): value is SkillTrustStatus {
  return (TRUST_VALUES as string[]).includes(value);
}

async function run(db: ParamDb, argv: string[]): Promise<number> {
  const command = argv[0];

  if (command === "list") {
    const all = await skillsRepository.listAll(db);
    if (all.length === 0) {
      console.log("(no skills installed)");
      return 0;
    }
    for (const skill of all) {
      const state = `${skill.trustStatus}${skill.enabled ? ", enabled" : ""}`;
      console.log(`${skill.slug}  [${state}]  ${skill.summary ?? skill.name}`);
    }
    return 0;
  }

  if (command === "add") {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: {
        summary: { type: "string" },
        source: { type: "string" },
        trust: { type: "string" },
        enable: { type: "boolean" },
      },
    });
    const slug = positionals[0];
    const name = positionals[1];
    if (!slug || !name) {
      console.error("add requires <slug> <name>\n\n" + USAGE);
      return 1;
    }
    const trust = values.trust ?? "untrusted";
    if (!isTrust(trust)) {
      console.error(`invalid --trust "${trust}" (trusted|untrusted|blocked)`);
      return 1;
    }
    await skillsRepository.upsertSkill(db, {
      slug,
      name,
      source: values.source,
      summary: values.summary,
      trustStatus: trust,
      enabled: values.enable === true,
    });
    const enabledNote =
      values.enable && trust !== "trusted"
        ? " (not enabled: must be trusted first)"
        : "";
    console.log(`skill "${slug}" saved (${trust})${enabledNote}`);
    return 0;
  }

  if (command === "trust") {
    const slug = argv[1];
    const status = argv[2];
    if (!slug || !status || !isTrust(status)) {
      console.error("trust requires <slug> <trusted|untrusted|blocked>");
      return 1;
    }
    await skillsRepository.setTrust(db, slug, status);
    console.log(`skill "${slug}" trust set to ${status}`);
    return 0;
  }

  if (command === "enable" || command === "disable") {
    const slug = argv[1];
    if (!slug) {
      console.error(`${command} requires <slug>`);
      return 1;
    }
    await skillsRepository.setEnabled(db, slug, command === "enable");
    console.log(`skill "${slug}" ${command}d`);
    return 0;
  }

  console.error(USAGE);
  return command ? 1 : 0;
}

async function main() {
  let db: ParamDb | undefined;
  try {
    const config = await loadConfig();
    db = createDbClient(config);
    process.exitCode = await run(db, process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await db?.$client.close();
  }
}

await main();

export {};
