import {
  toolDefinitionSchema,
  type ToolApprovalMode,
  type ToolDefinition,
  type ToolRiskLevel,
} from "../../contracts/tool";
import { ParamError } from "../../shared/errors";
import type { ToolHandler } from "../executor";
import type { ToolRegistry } from "../registry";

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Minimal shape of an MCP tool (a subset of the SDK's `Tool`). Declared
 * locally so the pure mapper can be tested without importing the SDK.
 */
export interface McpToolLike {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    [key: string]: unknown;
  };
}

/** Minimal shape of the SDK client we depend on (dynamically imported). */
interface McpClientLike {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools?: McpToolLike[] }>;
  callTool(params: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<{ content?: unknown; isError?: boolean }>;
  close(): Promise<void>;
}

export type McpCallResult = { content: unknown; isError: boolean };

/**
 * Heuristic for tool names that are safe to treat as read-only, e.g.
 * `get_page`, `search`, `list-issues`, `db.query`.
 */
const SAFE_READ_NAME_PATTERN =
  /(^|[._-])(get|list|read|search|fetch|query|find|show|describe|lookup|status|view|count)([._-]|$)/i;

/**
 * PURE mapping from an MCP tool descriptor to a Param `ToolDefinition`.
 *
 * Conservative by default: unknown MCP tools are treated as `write` risk with
 * `review` approval. Only names matching a safe read pattern (or an explicit
 * `readOnlyHint`) are downgraded to `safe_read` / `auto_if_safe`.
 */
export function mapMcpToolToDefinition(
  mcpTool: McpToolLike,
  serverName: string,
): ToolDefinition {
  const qualifiedName = `${serverName}.${mcpTool.name}`;
  const looksReadOnly =
    mcpTool.annotations?.readOnlyHint === true ||
    SAFE_READ_NAME_PATTERN.test(mcpTool.name);

  const riskLevel: ToolRiskLevel = looksReadOnly ? "safe_read" : "write";
  const approvalMode: ToolApprovalMode = looksReadOnly ? "auto_if_safe" : "review";

  return toolDefinitionSchema.parse({
    name: qualifiedName,
    source: "mcp",
    description: mcpTool.description ?? mcpTool.title ?? qualifiedName,
    inputSchema: mcpTool.inputSchema,
    outputSchema: mcpTool.outputSchema,
    riskLevel,
    approvalMode,
    executionMode: "mcp",
    enabled: true,
  });
}

/**
 * Thin wrapper over an MCP server connection. The SDK client + stdio transport
 * are imported LAZILY inside methods so importing this module never constructs
 * a client or spawns a server (keeping unit tests offline).
 */
export class McpToolSource {
  private client?: McpClientLike;

  constructor(private readonly config: McpServerConfig) {}

  private async ensureConnected(): Promise<McpClientLike> {
    if (this.client) {
      return this.client;
    }
    try {
      const { Client } = await import(
        "@modelcontextprotocol/sdk/client/index.js"
      );
      const { StdioClientTransport } = await import(
        "@modelcontextprotocol/sdk/client/stdio.js"
      );
      const transport = new StdioClientTransport({
        command: this.config.command,
        args: this.config.args ?? [],
        env: this.config.env,
      });
      const client = new Client({
        name: `param-mcp-${this.config.name}`,
        version: "0.1.0",
      }) as unknown as McpClientLike;
      await client.connect(transport);
      this.client = client;
      return client;
    } catch (error) {
      throw wrapMcpError(this.config.name, "connect", error);
    }
  }

  async listTools(): Promise<ToolDefinition[]> {
    try {
      const client = await this.ensureConnected();
      const result = await client.listTools();
      return (result.tools ?? []).map((tool) =>
        mapMcpToolToDefinition(tool, this.config.name),
      );
    } catch (error) {
      throw wrapMcpError(this.config.name, "listTools", error);
    }
  }

  /**
   * Execute an MCP tool. `toolName` is the Param-qualified name
   * (`<server>.<tool>`) or the bare MCP tool name; the server prefix is
   * stripped before the call.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult> {
    const prefix = `${this.config.name}.`;
    const bareName = toolName.startsWith(prefix)
      ? toolName.slice(prefix.length)
      : toolName;
    try {
      const client = await this.ensureConnected();
      const result = await client.callTool({ name: bareName, arguments: args });
      return {
        content: result.content ?? result,
        isError: result.isError === true,
      };
    } catch (error) {
      throw wrapMcpError(this.config.name, "callTool", error);
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (!client) {
      return;
    }
    try {
      await client.close();
    } catch (error) {
      throw wrapMcpError(this.config.name, "close", error);
    }
  }
}

/** What registerMcpTools needs from a source (McpToolSource satisfies it). */
export interface McpSourceLike {
  listTools(): Promise<ToolDefinition[]>;
  callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpCallResult>;
}

/**
 * List each MCP source's tools and register them into the toolset with a handler
 * that executes via callTool. A bad server is skipped (never breaks the toolset).
 * `riskOverrides` sets an EXPLICIT per-tool risk (keyed by the qualified name),
 * overriding the name heuristic — required before trusting an MCP tool to
 * auto-run. Action Review still gates every consequential call.
 */
export async function registerMcpTools(
  registry: ToolRegistry,
  handlers: Map<string, ToolHandler>,
  sources: McpSourceLike[],
  riskOverrides: Record<string, ToolRiskLevel> = {},
): Promise<void> {
  for (const source of sources) {
    let defs: ToolDefinition[];
    try {
      defs = await source.listTools();
    } catch {
      continue;
    }
    for (const def of defs) {
      const override = riskOverrides[def.name];
      const finalDef: ToolDefinition = override
        ? {
            ...def,
            riskLevel: override,
            approvalMode:
              override === "safe_read"
                ? ("auto_if_safe" as ToolApprovalMode)
                : ("review" as ToolApprovalMode),
          }
        : def;
      // SECURITY: on a name collision, skip BOTH the definition AND the handler.
      // Registering only the def conditionally but the handler unconditionally
      // would let an MCP tool named like a local tool (e.g. `service.status`)
      // keep the LOCAL safe/auto-run classification for policy while its handler
      // executes the external MCP code — running arbitrary code auto-approved,
      // escaping Action Review. Never overwrite an existing tool's handler.
      if (registry.has(finalDef.name)) {
        continue;
      }
      registry.register(finalDef);
      handlers.set(finalDef.name, {
        async execute(input: Record<string, unknown>): Promise<unknown> {
          const result = await source.callTool(finalDef.name, input);
          if (result.isError) {
            throw new ParamError(
              "runtime_unavailable",
              `MCP tool ${finalDef.name} reported an error`,
            );
          }
          return result.content;
        },
      });
    }
  }
}

function wrapMcpError(
  serverName: string,
  action: string,
  error: unknown,
): ParamError {
  if (error instanceof ParamError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ParamError(
    "runtime_unavailable",
    `MCP ${action} failed for server "${serverName}": ${message}`,
    { serverName, action },
  );
}
