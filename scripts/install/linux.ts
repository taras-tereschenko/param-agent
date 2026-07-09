import {
  configSteps,
  databaseSteps,
  runtimeSteps,
  type HostPlan,
  type InstallOptions,
} from "./plan";

/** systemd + apt host plan (Hetzner CX23 / Debian/Ubuntu default). */
export function buildLinuxPlan(options: InstallOptions): HostPlan {
  const steps = [
    {
      id: "bun",
      description: "ensure Bun is installed",
      command: "curl -fsSL https://bun.sh/install | bash",
      mutating: true,
    },
    ...(options.skipPostgres || options.mode === "existing-url"
      ? []
      : [
          {
            id: "pkg:postgres",
            description: "install postgresql + postgresql-<v>-pgvector",
            command: "apt-get install -y postgresql postgresql-contrib",
            mutating: true,
            privileged: true,
          },
        ]),
    ...runtimeSteps(options.runtimes, (pkg) => `bun add -g ${pkg}`),
    ...(options.skipService
      ? []
      : [
          {
            id: "service:user",
            description: `create service user ${options.serviceUser}`,
            command: `useradd --system --home ${options.dataDir} ${options.serviceUser}`,
            mutating: true,
            privileged: true,
          },
        ]),
    {
      id: "dirs",
      description: `create data/log/workspace/artifact dirs under ${options.dataDir}`,
      mutating: true,
      privileged: true,
    },
    ...configSteps(options),
    ...databaseSteps(options),
    ...(options.skipService
      ? []
      : [
          {
            id: "service:install",
            description: "install param-app.service + param-worker.service (systemd)",
            command: "systemctl enable --now param-app param-worker",
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
    platform: "linux",
    packageManager: "apt",
    serviceManager: "systemd",
    steps,
  };
}
