# Param Agent Tools

This file defines how Param exposes real capabilities.

## Decision

Param should not invent a full tool/plugin ecosystem.

Use established patterns:

```text
skills.sh
  procedural knowledge

MCP
  external tools, connectors, resources, and workflows

schema-based tools
  local/internal Param tools

Param Tool Registry
  normalization, policy, audit, and approval

Action Review
  final side-effect gate
```

The Tool Registry is not a marketplace. It is the local control plane that
decides which tools exist, how they are shown to actors, and whether a proposed
call can execute.

## Core Rule

Tools are capability.

Skills are advice.

MCP servers are external providers.

Action Review gates side effects.

No tool source can bypass Param policy.

## Tool Sources

Param can expose tools from several sources.

Local Param tools:
  built into Param, such as file reads, health checks, artifact creation, memory
  review, Telegram delivery helpers, and server self-management

MCP tools:
  tools exposed by configured MCP servers

Runtime adapter tools:
  capabilities routed through Codex, OpenCode, Antigravity, image generation,
  browser automation, or future CLIs

Channel tools:
  platform-specific delivery helpers such as Telegram send, reaction, callback,
  file upload, and Mini App launch

External API tools:
  APIs Param calls directly, usually through MCP or a local wrapper

## Tool Definition

Every tool becomes one normalized definition.

```ts
type ToolDefinition = {
  id: string;
  name: string;
  source: "local" | "mcp" | "runtime" | "channel" | "external";
  version: string;
  description: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
  riskLevel: ToolRiskLevel;
  executionMode: "sync" | "queued" | "streaming";
  approval: "safe_auto_run" | "auto_review" | "manual" | "blocked";
  scopes: string[];
  enabled: boolean;
  metadata?: JsonObject;
};

type ToolRiskLevel =
  | "safe_read"
  | "private_read"
  | "write"
  | "external_send"
  | "server"
  | "security"
  | "spend"
  | "destructive";
```

Tool inputs are validated before execution.

Tool outputs are untrusted context after execution.

## Actor Exposure

Do not dump every tool into the actor context.

Use metadata-first discovery:

1. Context Builder includes a small set of relevant tool summaries.
2. Actor can request a tool by name or ask for tool discovery.
3. Orchestrator checks policy and session scope.
4. Full tool schema is loaded only for tools that may be used in this run.
5. The actor emits a structured `tool_call`.

This keeps context smaller and reduces accidental tool use.

## Execution Flow

```text
actor emits tool_call
  -> output schema validation
  -> Tool Registry resolves tool
  -> input schema validation
  -> policy and scope check
  -> Action Review
  -> approval, if needed
  -> execution in correct runner
  -> result validation
  -> audit record
  -> tool.result event
  -> actor sees result as untrusted context
```

The actor never executes a tool directly.

## Safe Auto-Run

Safe auto-run is intentionally tiny.

Examples:

```text
system.health.read
logs.tail_recent
fs.read_scoped
git.status
jobs.list
memory.search_metadata
skills.search_metadata
```

Safe auto-run tools must be:

- read-only
- scoped
- non-secret
- cheap
- predictable
- auditable
- unable to mutate external state

If uncertain, use auto-review or manual approval.

## Action Review

Detailed approval behavior lives in `docs/ACTION_REVIEW.md`.

Tool approval is based on:

- requester identity
- session type
- trust scope
- tool risk level
- exact input
- target paths or external resources
- whether private data leaves the system
- whether money, accounts, services, files, or config change

Approvals bind to exact tool inputs. If the tool input changes, the approval is
invalid.

## MCP Integration

MCP is the default external plugin/tool protocol.

Param acts as an MCP client.

Configured MCP servers can expose:

- tools
- resources
- prompts/workflows

Param should import MCP tools into the Tool Registry instead of exposing MCP
servers directly to the actor.

MCP tool names should be namespaced:

```text
mcp.<server_id>.<tool_name>
```

MCP resources are context sources, not automatic memory.

MCP prompts/workflows can be treated like skills or task templates after review.

## MCP Security

MCP tools and resources are untrusted until configured and reviewed.

Rules:

- no automatic trust because a server is MCP-compatible
- no direct execution without Tool Registry policy
- namespace all tools to prevent lookalike collisions
- store server identity and config hash
- validate tool schemas before exposing them
- cap output size
- treat resource contents as prompt-injection-capable
- redact secrets before actor context
- require approval for external sends, writes, server changes, spend, and
  private data export

Adding, removing, or changing an MCP server is a state-changing action.

## Local Tool Families

Initial local tool families:

```text
system.*
  health, service status, disk usage, uptime

logs.*
  scoped log reads and recent error summaries

fs.*
  scoped file read/write operations

git.*
  status, diff, log, commit helpers

shell.*
  reviewed command execution

packages.*
  package installs and updates

service.*
  restart/reload/status for systemd services

telegram.*
  send, react, upload, callback, Mini App launch

artifact.*
  create, store, list, attach

image.*
  generate or edit image through configured provider

skills.*
  search, inspect, install, update, enable, disable

mcp.*
  tools imported from configured MCP servers
```

## Shell Commands

Shell is a tool family, not a free-form escape hatch.

Shell tool calls should include:

- command
- args
- working directory
- environment policy
- timeout
- expected output
- reason
- risk hint

Prefer argv arrays over shell strings when possible.

Commands that use shell parsing, redirection, pipes, network access, package
install, service management, filesystem writes, secrets, or destructive actions
require stricter review.

## Filesystem Tools

Filesystem tools must be path-scoped.

Default writable roots:

- Param workspace
- task/runtime workspaces
- artifact directory
- explicitly approved config paths

Server paths are higher risk than project paths.

File writes should record:

- previous hash, when available
- new hash
- actor run id
- approval id, if any
- diff or summary

## Server Self-Management

Param can manage itself and the VPS through tools.

Examples:

- check service status
- read logs
- install package
- update config
- run migrations
- restart Param
- restart Telegram polling worker
- check Postgres backup freshness

Server-changing tools require Action Review and usually trusted approval.

Before restart, Param must persist state and record an audit event.

## Tool Results

Tool results should be structured.

```ts
type ToolResult = {
  toolCallId: string;
  status: "ok" | "error" | "cancelled" | "denied" | "needs_approval";
  summary: string;
  data?: JsonObject;
  artifacts?: Id[];
  redactions?: string[];
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
};
```

Do not dump huge raw outputs into actor context.

Large outputs become artifacts with summaries.

## Config

```ts
type ToolsConfig = {
  safeAutoRun: string[];
  disabled?: string[];
  policies?: Record<string, ToolPolicyConfig>;
  mcp?: McpToolsConfig;
  execution?: ToolExecutionConfig;
};

type ToolPolicyConfig = {
  riskLevel: ToolRiskLevel;
  approval: "safe_auto_run" | "auto_review" | "manual" | "blocked";
  scopes?: string[];
};

type McpToolsConfig = {
  enabled: boolean;
  servers: Record<string, McpServerConfig>;
};

type McpServerConfig = {
  enabled: boolean;
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string | SecretRef>;
  trust: "unreviewed" | "trusted" | "restricted" | "blocked";
};

type ToolExecutionConfig = {
  defaultTimeoutSeconds: number;
  maxOutputBytes: number;
  maxConcurrentToolCalls: number;
};
```

## Tests

Tool tests should cover:

- tool definitions require input schemas
- invalid tool input is rejected
- safe auto-run accepts only read-only scoped tools
- risky tools require Action Review
- approval is bound to exact input
- changed input invalidates approval
- MCP tool names are namespaced
- MCP resource content is treated as untrusted
- shell command preview is reviewable
- filesystem writes are path-scoped
- tool output is summarized or artifacted when large
- tool result becomes a `tool.result` event

## References

- MCP intro: `https://modelcontextprotocol.io/docs/getting-started/intro`
- AI SDK tool calling: `https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling`
- OpenAI function calling: `https://developers.openai.com/api/docs/guides/function-calling`
