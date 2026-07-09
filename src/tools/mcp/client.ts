import {
  toolDefinitionSchema,
  type ToolApprovalMode,
  type ToolDefinition,
  type ToolRiskLevel,
} from "../../contracts/tool";
import { ParamError } from "../../shared/errors";

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
  close(): Promise<void>;
}

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
