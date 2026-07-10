import {
  configSteps,
  databaseSteps,
  runtimeSteps,
  type HostPlan,
  type InstallOptions,
} from "./plan";

/** winget + Windows Service host plan (local/dev Windows). */
export function buildWindowsPlan(options: InstallOptions): HostPlan {
  const steps = [
    {
      id: "bun",
      description: "ensure Bun is installed",
      command: "powershell -c \"irm bun.sh/install.ps1 | iex\"",
      mutating: true,
    },
    ...(options.skipPostgres || options.mode === "existing-url"
      ? []
      : [
          {
            id: "pkg:postgres",
            description: "install PostgreSQL (winget) + pgvector",
            command: "winget install PostgreSQL.PostgreSQL",
            mutating: true,
          },
        ]),
    ...runtimeSteps(options.runtimes, (pkg) => `bun add -g ${pkg}`, {
      codex:
        'powershell -ExecutionPolicy Bypass -c "irm https://chatgpt.com/codex/install.ps1 | iex"',
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
            description: "register param-app + param-worker as Windows Services",
            command: "sc.exe create ParamWorker binPath= ...",
            mutating: true,
            privileged: true,
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
    platform: "windows",
    packageManager: "winget",
    serviceManager: "windows-service",
    steps,
  };
}
