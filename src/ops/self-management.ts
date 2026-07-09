import type { ToolDefinition } from "../contracts/tool";

/**
 * Server self-management tools. These EXIST ONLY BEHIND Action Review: every
 * consequential one is risk "server" with approvalMode "manual", so the tool
 * policy forces trusted approval before it can run. Read-only checks are
 * safe_read. Handlers in this build are conservative (they report/plan rather
 * than perform destructive changes) so nothing dangerous runs unattended.
 */
export const selfManagementTools: ToolDefinition[] = [
  {
    name: "service.status",
    source: "local",
    description: "report Param service + process status",
    riskLevel: "safe_read",
    approvalMode: "auto_if_safe",
    enabled: true,
  },
  {
    name: "logs.tail",
    source: "local",
    description: "tail recent Param logs (read-only)",
    riskLevel: "safe_read",
    approvalMode: "review",
    enabled: true,
  },
  {
    name: "service.restart",
    source: "local",
    description: "restart a Param service (systemd/launchd/windows-service)",
    riskLevel: "server",
    approvalMode: "manual",
    enabled: true,
  },
  {
    name: "backup.run",
    source: "local",
    description: "run a database backup",
    riskLevel: "server",
    approvalMode: "manual",
    enabled: true,
  },
  {
    name: "package.install",
    source: "local",
    description: "install a system package on the host",
    riskLevel: "server",
    approvalMode: "manual",
    enabled: true,
  },
];

export function processStatus(): {
  pid: number;
  uptimeSeconds: number;
  rssBytes: number;
  nodeVersion: string;
} {
  return {
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    rssBytes: process.memoryUsage().rss,
    nodeVersion: process.version,
  };
}
