import { parseArgs } from "node:util";

import { detectHostPlatform, isRuntimeChoice } from "../src/ops/setup";
import type { RuntimeChoice } from "../src/ops/setup";
import { buildLinuxPlan } from "./install/linux";
import { buildMacosPlan } from "./install/macos";
import { buildWindowsPlan } from "./install/windows";
import { defaultInstallOptions, type HostPlan, type InstallOptions } from "./install/plan";

/**
 * Cross-platform installer entrypoint. It always prints an action plan before
 * making changes. `--dry-run`/`--check` only print the plan. Privileged steps
 * (package/service/db) are surfaced with their commands for the operator; only
 * the non-privileged app steps are executed with `--yes`. Idempotent by design:
 * it never silently overwrites config, secrets, data, or service files.
 */
const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    check: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    mode: { type: "string", default: "local-postgres" },
    "skip-postgres": { type: "boolean", default: false },
    "skip-service": { type: "boolean", default: false },
    "skip-systemd": { type: "boolean", default: false },
    "create-local-config": { type: "boolean", default: true },
    "owner-telegram-user-id": { type: "string" },
    "discover-telegram-ids": { type: "boolean", default: false },
    runtime: { type: "string", multiple: true },
  },
  allowPositionals: false,
});

function selectedRuntimes(): RuntimeChoice[] {
  const flags = (values.runtime as string[] | undefined) ?? [];
  if (flags.includes("none")) return [];
  if (flags.length === 0 || flags.includes("all")) {
    return defaultInstallOptions.runtimes;
  }
  return flags.filter(isRuntimeChoice);
}

function planFor(platform: ReturnType<typeof detectHostPlatform>, options: InstallOptions): HostPlan {
  switch (platform) {
    case "linux":
      return buildLinuxPlan(options);
    case "macos":
      return buildMacosPlan(options);
    case "windows":
      return buildWindowsPlan(options);
  }
}

function printPlan(plan: HostPlan): void {
  console.log(`\nParam installer — action plan (${plan.platform})`);
  console.log(`  package manager: ${plan.packageManager}`);
  console.log(`  service manager: ${plan.serviceManager}\n`);
  plan.steps.forEach((step, index) => {
    const marks = [
      step.mutating ? "mutating" : "read-only",
      step.privileged ? "privileged" : undefined,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`  ${index + 1}. [${marks}] ${step.description}`);
    if (step.command) {
      console.log(`       $ ${step.command}`);
    }
  });
  console.log("");
}

async function main() {
  const platform = detectHostPlatform();
  const mode = values.mode === "existing-url" ? "existing-url" : "local-postgres";
  const options: InstallOptions = {
    ...defaultInstallOptions,
    mode,
    runtimes: selectedRuntimes(),
    skipPostgres: Boolean(values["skip-postgres"]),
    skipService: Boolean(values["skip-service"] || values["skip-systemd"]),
    createLocalConfig: Boolean(values["create-local-config"]),
  };

  const plan = planFor(platform, options);
  printPlan(plan);
  console.log(
    "Config (.env + param.config.local.ts) is created by `bun run setup` (interactive). Run it before starting services.\n",
  );

  const dryRun = Boolean(values["dry-run"] || values.check);
  if (dryRun) {
    console.log("dry run: no changes made. Re-run with --yes to execute app steps.");
    return;
  }

  if (!values.yes) {
    console.log(
      "no --yes flag: not executing. Review the plan and run privileged steps manually, or re-run with --yes.",
    );
    return;
  }

  // Execute only non-privileged app steps that have a command (e.g. migrations,
  // doctor). Privileged package/service/db steps are left to the operator.
  for (const step of plan.steps) {
    if (!step.command || step.privileged || step.interactive) {
      continue;
    }
    if (!step.command.startsWith("bun run")) {
      console.log(`skipping non-app step: ${step.id}`);
      continue;
    }
    console.log(`running: ${step.command}`);
    const [cmd, ...args] = step.command.split(" ");
    const proc = Bun.spawn([cmd!, ...args], { stdout: "inherit", stderr: "inherit" });
    const code = await proc.exited;
    if (code !== 0) {
      console.error(`step ${step.id} failed (exit ${code})`);
      process.exitCode = 1;
      return;
    }
  }
}

await main();
