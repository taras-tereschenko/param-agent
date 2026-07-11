import type { ToolApprovalMode, ToolRiskLevel } from "../../contracts/tool";
import { logger } from "../../observability/logger";
import type { ToolHandler } from "../executor";
import type { ToolRegistry } from "../registry";
import {
  McpToolSource,
  registerMcpTools,
  type McpServerConfig,
  type McpSourceLike,
} from "./client";

const log = logger.child("mcp");

/**
 * A configured MCP server plus whether the operator has marked it TRUSTED.
 * Only trusted servers keep the read-name heuristic (which lets `get_*`/`list_*`
 * tools auto-run); everything else is forced to `write`/`review` so an
 * unreviewed server can never auto-run a tool.
 */
export type McpServerEntry = {
  source: McpSourceLike;
  trusted: boolean;
};

/**
 * Wrap a source so every tool it lists is forced to `write` + `review`. Used for
 * non-trusted servers: the tool is still available, but every call must pass
 * Action Review (never auto-runs on the name heuristic). Single listTools call,
 * so there is no window where the heuristic risk leaks through.
 */
function forceReview(source: McpSourceLike): McpSourceLike {
  return {
    async listTools() {
      const defs = await source.listTools();
      return defs.map((def) => ({
        ...def,
        riskLevel: "write" as ToolRiskLevel,
        approvalMode: "review" as ToolApprovalMode,
      }));
    },
    callTool: (name, args) => source.callTool(name, args),
  };
}

/**
 * Register the given MCP server entries into the toolset. Trusted servers use
 * the mapper's risk heuristic; non-trusted servers are review-gated. A bad
 * server is skipped by registerMcpTools (never breaks the toolset).
 */
export async function registerMcpServers(
  registry: ToolRegistry,
  handlers: Map<string, ToolHandler>,
  entries: McpServerEntry[],
): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const sources = entries.map((entry) =>
    entry.trusted ? entry.source : forceReview(entry.source),
  );
  await registerMcpTools(registry, handlers, sources);
}

/**
 * Build MCP server entries from config: stdio servers with a command, not
 * blocked. http/sse transports are skipped (only stdio is implemented) with a
 * clear log. Secret env values are resolved by `resolveEnvValue`.
 */
export function buildMcpEntriesFromConfig(
  mcp:
    | {
        enabled?: boolean;
        servers?: Record<
          string,
          {
            enabled: boolean;
            transport: "stdio" | "http" | "sse";
            command?: string;
            args?: string[];
            env?: Record<string, unknown>;
            trust: "unreviewed" | "trusted" | "restricted" | "blocked";
          }
        >;
      }
    | undefined,
  resolveEnvValue: (value: unknown) => string | undefined,
): McpServerEntry[] {
  if (!mcp?.enabled || !mcp.servers) {
    return [];
  }
  const entries: McpServerEntry[] = [];
  for (const [name, server] of Object.entries(mcp.servers)) {
    if (!server.enabled || server.trust === "blocked") {
      continue;
    }
    if (server.transport !== "stdio") {
      log.warn("skipping non-stdio MCP server (only stdio is implemented)", {
        server: name,
        transport: server.transport,
      });
      continue;
    }
    if (!server.command) {
      log.warn("skipping stdio MCP server with no command", { server: name });
      continue;
    }
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(server.env ?? {})) {
      const resolved = resolveEnvValue(value);
      if (resolved !== undefined) {
        env[key] = resolved;
      }
    }
    const config: McpServerConfig = {
      name,
      command: server.command,
      args: server.args,
      env: Object.keys(env).length > 0 ? env : undefined,
    };
    entries.push({
      source: new McpToolSource(config),
      trusted: server.trust === "trusted",
    });
  }
  return entries;
}
