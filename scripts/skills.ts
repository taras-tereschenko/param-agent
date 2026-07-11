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
  "  bun run skills trust <slug> <trusted|untrusted|blocked> [--source <s>]",
  "  bun run skills enable <slug> [--source <s>]",
  "  bun run skills disable <slug> [--source <s>]",
  "  (--source defaults to \"local\")",
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
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: { source: { type: "string" } },
    });
    const slug = positionals[0];
    const status = positionals[1];
    const source = values.source ?? "local";
    if (!slug || !status || !isTrust(status)) {
      console.error("trust requires <slug> <trusted|untrusted|blocked> [--source <s>]");
      return 1;
    }
    const changed = await skillsRepository.setTrust(db, source, slug, status);
    if (changed === 0) {
      console.error(`no skill "${slug}" from source "${source}"`);
      return 1;
    }
    console.log(`skill "${slug}" (${source}) trust set to ${status}`);
    return 0;
  }

  if (command === "enable" || command === "disable") {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      allowPositionals: true,
      options: { source: { type: "string" } },
    });
    const slug = positionals[0];
    const source = values.source ?? "local";
    if (!slug) {
      console.error(`${command} requires <slug> [--source <s>]`);
      return 1;
    }
    const changed = await skillsRepository.setEnabled(
      db,
      source,
      slug,
      command === "enable",
    );
    if (changed === 0) {
      console.error(
        command === "enable"
          ? `could not enable "${slug}" (${source}) — is it installed and trusted?`
          : `no skill "${slug}" from source "${source}"`,
      );
      return 1;
    }
    console.log(`skill "${slug}" (${source}) ${command}d`);
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
