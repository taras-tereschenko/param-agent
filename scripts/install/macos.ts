import {
  configSteps,
  databaseSteps,
  runtimeSteps,
  type HostPlan,
  type InstallOptions,
} from "./plan";

/** Homebrew + launchd host plan (local/dev macOS). */
export function buildMacosPlan(options: InstallOptions): HostPlan {
  const steps = [
    {
      id: "bun",
      description: "ensure Bun is installed",
      command: "brew install oven-sh/bun/bun",
      mutating: true,
    },
    ...(options.skipPostgres || options.mode === "existing-url"
      ? []
      : [
          {
            id: "pkg:postgres",
            description: "install postgresql + pgvector via Homebrew",
            command: "brew install postgresql@16 pgvector",
            mutating: true,
          },
        ]),
    ...runtimeSteps(options.runtimes, (pkg) => `bun add -g ${pkg}`, {
      codex: "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    }),
    {
      id: "dirs",
      description: `create data/log/workspace/artifact dirs under ${options.dataDir}`,
      mutating: true,
    },
    ...configSteps(options),
    ...databaseSteps(options),
    ...(options.skipService
      ? []
      : [
          {
            id: "service:install",
            description: "install launchd agents for param-app + param-worker",
            command: "launchctl load ~/Library/LaunchAgents/param-*.plist",
            mutating: true,
          },
        ]),
    {
      id: "doctor",
      description: "run health checks",
      command: "bun run doctor",
      mutating: false,
    },
  ];
  return {
    platform: "macos",
    packageManager: "homebrew",
    serviceManager: "launchd",
    steps,
  };
}
