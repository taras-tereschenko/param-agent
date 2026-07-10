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

  test("codex runtime step uses the official installer per host", () => {
    const linux = buildLinuxPlan(defaultInstallOptions);
    const macos = buildMacosPlan(defaultInstallOptions);
    const windows = buildWindowsPlan(defaultInstallOptions);
    const cmd = (plan: typeof linux, id: string) =>
      plan.steps.find((s) => s.id === id)?.command ?? "";

    // macOS/Linux use the shell installer; Windows uses the PowerShell one.
    expect(cmd(linux, "runtime:codex")).toContain(
      "https://chatgpt.com/codex/install.sh",
    );
    expect(cmd(macos, "runtime:codex")).toContain(
      "https://chatgpt.com/codex/install.sh",
    );
    expect(cmd(windows, "runtime:codex")).toContain("install.ps1");
    // regression guard: no sh command on Windows
    expect(cmd(windows, "runtime:codex")).not.toContain("install.sh");

    // opencode/antigravity still install as global packages.
    expect(cmd(linux, "runtime:opencode")).toContain("bun add -g opencode-ai");
  });
});
