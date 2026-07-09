import { describe, expect, test } from "bun:test";

import { buildLinuxPlan } from "../../scripts/install/linux";
import { buildMacosPlan } from "../../scripts/install/macos";
import { buildWindowsPlan } from "../../scripts/install/windows";
import { defaultInstallOptions } from "../../scripts/install/plan";

describe("install plans (dry-run buildable per host)", () => {
  test("linux plan uses systemd/apt and includes all steps", () => {
    const plan = buildLinuxPlan(defaultInstallOptions);
    expect(plan.serviceManager).toBe("systemd");
    expect(plan.packageManager).toBe("apt");
    expect(plan.steps.some((s) => s.id === "db:migrate")).toBe(true);
    expect(plan.steps.some((s) => s.id === "service:install")).toBe(true);
    // one runtime step per selected runtime
    expect(plan.steps.filter((s) => s.id.startsWith("runtime:")).length).toBe(
      defaultInstallOptions.runtimes.length,
    );
  });

  test("macos + windows plans build with their service managers", () => {
    expect(buildMacosPlan(defaultInstallOptions).serviceManager).toBe("launchd");
    expect(buildWindowsPlan(defaultInstallOptions).serviceManager).toBe(
      "windows-service",
    );
  });

  test("skip-service omits service install; existing-url skips postgres package", () => {
    const noService = buildLinuxPlan({
      ...defaultInstallOptions,
      skipService: true,
    });
    expect(noService.steps.some((s) => s.id === "service:install")).toBe(false);

    const existingUrl = buildLinuxPlan({
      ...defaultInstallOptions,
      mode: "existing-url",
    });
    expect(existingUrl.steps.some((s) => s.id === "pkg:postgres")).toBe(false);
    expect(existingUrl.steps.some((s) => s.id === "db:migrate")).toBe(true);
  });

  test("runtime none selects no runtime steps", () => {
    const plan = buildLinuxPlan({ ...defaultInstallOptions, runtimes: [] });
    expect(plan.steps.filter((s) => s.id.startsWith("runtime:")).length).toBe(0);
  });
});
