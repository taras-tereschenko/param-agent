import type { HostPlatform, RuntimeChoice } from "../../src/ops/setup";

/** One planned installer step. `mutating` steps only run outside dry-run. */
export type HostStep = {
  id: string;
  description: string;
  command?: string;
  mutating: boolean;
  privileged?: boolean;
  /** Requires an interactive TTY (e.g. `bun run setup`); never auto-run. */
  interactive?: boolean;
};

export type HostPlan = {
  platform: HostPlatform;
  packageManager: string;
  serviceManager: string;
  steps: HostStep[];
};

export type InstallOptions = {
  mode: "local-postgres" | "existing-url";
  runtimes: RuntimeChoice[];
  skipPostgres: boolean;
  skipService: boolean;
  serviceUser: string;
  dataDir: string;
  createLocalConfig: boolean;
};

export const defaultInstallOptions: InstallOptions = {
  mode: "local-postgres",
  runtimes: ["codex", "opencode", "antigravity"],
  skipPostgres: false,
  skipService: false,
  serviceUser: "param",
  dataDir: "/var/lib/param-agent",
  createLocalConfig: true,
};

/** Runtime-install steps shared across hosts (verify against official docs). */
export function runtimeSteps(
  runtimes: RuntimeChoice[],
  installCmd: (pkg: string) => string,
): HostStep[] {
  // Global-package name for runtimes that install that way.
  const pkg: Record<RuntimeChoice, string> = {
    codex: "@openai/codex",
    opencode: "opencode-ai",
    antigravity: "antigravity",
  };
  // Codex's official install is a standalone script (Rust binary, no Node),
  // preferred over the npm package. macOS/Linux use install.sh; the npm package
  // remains a fallback. (Windows uses install.ps1 — verify per host.)
  const officialCommand: Partial<Record<RuntimeChoice, string>> = {
    codex: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
  };
  return runtimes.map((runtime) => ({
    id: `runtime:${runtime}`,
    description: `install/check ${runtime} CLI (verify current official install command)`,
    command: officialCommand[runtime] ?? installCmd(pkg[runtime]),
    mutating: true,
    privileged: false,
  }));
}

export function configSteps(options: InstallOptions): HostStep[] {
  // Config creation is owned by the interactive `bun run setup` (it prompts for
  // the owner Telegram id + bot token and never overwrites existing files).
  const steps: HostStep[] = [
    {
      id: "config:setup",
      description:
        "run `bun run setup` (interactive) to create .env + param.config.local.ts if missing (never overwrites)",
      command: "bun run setup",
      mutating: true,
      interactive: true,
    },
  ];
  void options;
  return steps;
}

export function databaseSteps(options: InstallOptions): HostStep[] {
  if (options.mode === "existing-url" || options.skipPostgres) {
    return [
      {
        id: "db:migrate",
        description: "run drizzle migrations + ensure pgcrypto/vector + indexes",
        command: "bun run db:migrate",
        mutating: true,
      },
    ];
  }
  return [
    {
      id: "db:extensions",
      description: "enable Postgres extensions pgcrypto + vector",
      mutating: true,
      privileged: true,
    },
    {
      id: "db:migrate",
      description: "run drizzle migrations + ensure indexes",
      command: "bun run db:migrate",
      mutating: true,
    },
  ];
}
