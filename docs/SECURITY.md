# Param Agent Security And Threat Model

This file defines Param's security model.

## Goal

Param is an always-online agent with chat access, memory, tools, runtimes,
MCP servers, Telegram Mini Apps, and server self-management.

That makes security part of the architecture, not a later hardening pass.

## Core Rule

Untrusted input can appear anywhere.

Treat these as untrusted:

- chat messages
- group chat instructions
- Telegram raw payloads
- Mini App input
- tool results
- MCP tool descriptions and resource contents
- skills from third parties
- runtime adapter output
- web pages
- files in workspaces
- memory candidates
- generated UI specs

Trusted users can approve actions. They do not make untrusted content safe.

## Security Layers

```text
typed contracts
  validate events, actor outputs, tools, UI specs, and config

orchestrator
  deterministic routing, locks, stale-run prevention, batching, recovery

context builder
  scoped memory, relevant skills, selected tools, redaction

actor
  decides meaning, but cannot directly execute side effects

validators
  parse and reject malformed output

Tool Registry
  resolves tools, validates inputs, applies policy

Action Review
  classifies risk, requires trusted approval, records audit

runtime adapters
  execute through scoped workspaces and Param policy

storage and audit
  durable events, append-only audit, provenance
```

No single layer is enough.

## Trust Boundaries

Telegram boundary:
  platform updates, user ids, chat ids, callbacks, files, and reactions enter
  through the Telegram Channel Adapter

Session boundary:
  each DM, group, topic, task agent, and UI surface has separate session state

Actor boundary:
  the LLM receives curated context and emits structured intent, not direct
  execution

Tool boundary:
  every tool call goes through Tool Registry and Action Review

MCP boundary:
  MCP servers are external providers, not trusted code

Runtime boundary:
  Codex/OpenCode/Antigravity can help, but their approvals do not replace
  Param policy

Memory boundary:
  memory is scoped, provenance-aware, and never treated as raw authority

Filesystem boundary:
  runtime and task workspaces are scoped; server paths are high risk

Network boundary:
  external fetches, OAuth flows, MCP servers, Mini Apps, and web browsing can
  leak data or reach internal services

Secret boundary:
  secrets live in `.env` or secret references and never enter actor context

## Threats And Controls

### Prompt Injection

Threat:
  a message, web page, tool result, MCP resource, file, skill, or memory tries
  to override Param's policy or steal data

Controls:

- keep trust policy outside actor-changeable text
- label untrusted context by source
- never let tool output modify system policy
- require structured actor outputs
- validate every output
- keep Action Review deterministic at the final decision point
- reject attempts to change trusted users, permissions, memory policy, or
  secrets through prompt text

### Excessive Agency

Threat:
  the actor takes real-world or server actions without enough control

Controls:

- tiny safe auto-run list
- exact input validation for every tool
- Action Review for consequential actions
- trusted approval for server, write, spend, external-send, security, or
  private-data actions
- action approvals bind to exact inputs
- changed inputs require new approval
- one-shot approvals are marked used

### Sensitive Information Disclosure

Threat:
  Param leaks secrets, private chat context, cross-session memory, files, logs,
  tokens, raw tool output, or personal data

Controls:

- never expose raw secrets to actor context
- redact logs and traces by default
- scope memory by user, chat, group, task, and provenance
- require approval for private-data export
- summarize large or sensitive tool output before actor context
- keep real chat eval fixtures opt-in and redacted
- avoid storing raw private payloads longer than useful for audit/replay

### Insecure Output Handling

Threat:
  LLM output becomes code, shell, SQL, UI, file writes, or external messages
  without validation

Controls:

- actor outputs are schemas, not freeform execution
- `render_ui` specs are validated
- theme patches allow approved shadcn tokens only
- tool inputs are validated before execution
- shell commands are reviewed as command/args/working directory/intent
- file writes record hashes and diffs

### Tool Poisoning And Lookalike Tools

Threat:
  malicious MCP tools or tool metadata trick the actor into using the wrong
  capability

Controls:

- namespace MCP tools as `mcp.<server_id>.<tool_name>`
- store server identity and config hash
- review tool descriptions before exposing them
- validate schemas before exposure
- compare tool definition changes before update
- do not auto-enable changed tools
- keep selected tool list small
- require Action Review for adding/changing MCP servers

### MCP Server And OAuth Risks

Threat:
  MCP server configuration, OAuth metadata, tokens, redirects, or sessions are
  abused for token theft, SSRF, or impersonation

Controls:

- do not pass through arbitrary tokens
- require HTTPS for production OAuth endpoints
- validate redirect URIs exactly
- use single-use state parameters for OAuth
- block or proxy requests to private, loopback, link-local, and metadata IPs
  when doing server-side discovery/fetch
- do not blindly follow redirects to internal networks
- bind remote MCP sessions to authenticated identity
- do not use MCP session ids as authentication
- expire and rotate sessions when appropriate

### Local MCP Server Compromise

Threat:
  a local MCP server command or binary executes malicious code on the VPS

Controls:

- MCP server additions require review
- show exact command and args before approval
- treat stdio MCP servers as code execution
- run with the Param service user's limited privileges
- avoid root
- restrict filesystem and network access where possible
- record server config hash
- disable or restrict unknown servers by default

### Skills Supply Chain

Threat:
  a skills.sh or local skill contains malicious instructions, scripts, or hidden
  tool requirements

Controls:

- skills are advice, not capability
- install/update/enable/disable requires Action Review
- use skills.sh audit metadata when available
- record content hashes
- load metadata first, full content only when selected
- disabled skills never enter context
- declared tool needs do not grant access

### Runtime Adapter Bypass

Threat:
  Codex, OpenCode, Antigravity, or another runtime performs side effects outside
  Param review

Controls:

- Param wraps runtime adapters with its own policy
- runtime approvals are defense-in-depth only
- workspaces are scoped per run/task
- server paths require stricter approval
- visible output goes through Param style/output validation
- tool/file/shell proposals return as intent for Param review

### Telegram Identity And Approval Spoofing

Threat:
  someone fakes approval, reuses an approval, or tricks Param through group chat

Controls:

- route by stable Telegram ids, not display names
- store requester and approver separately
- approval replies must target the approval message or include exact approval id
- only trusted users with required scope count
- stale approvals expire
- action changes invalidate approval
- non-trusted approval replies are ignored as approval

### Telegram Mini App Forgery

Threat:
  forged Mini App data or callbacks cause actions in a chat

Controls:

- validate Telegram init data server-side
- bind Mini App requests to `surfaceId`
- bind user id and session id
- reject expired surfaces
- reject callback replay
- validate result payload before actor context
- consequential callbacks still go through Action Review

### SSRF And Internal Network Access

Threat:
  web browsing, MCP discovery, OAuth metadata, or tools reach internal network
  services or cloud metadata endpoints

Controls:

- require HTTPS for production remote integrations
- block private/reserved/link-local/metadata IP ranges for server-side fetches
- validate redirect targets
- avoid automatic redirect following when risk is high
- use an egress proxy later if network policy becomes complex
- require approval for tools that can fetch arbitrary URLs with credentials

### Denial Of Service And Cost Abuse

Threat:
  users or loops cause too many actor runs, task agents, tool calls, model calls,
  image generations, or retries

Controls:

- per-session batching
- cooldowns for ambient wakes
- concurrency limits
- budgets for actor runs and task agents
- tool timeouts
- output size caps
- retry limits
- cost tracking
- rate limits per chat/user/tool

### Stale Runs And Race Conditions

Threat:
  Param sends stale replies or executes stale actions after new messages arrive

Controls:

- one active main actor run per session
- same-session messages during a run become steering context
- pre-send refresh before visible output or side effect
- hard controls cancel or block runs
- approvals bind to the current exact action
- delivery dedupe keys prevent duplicate sends

### Audit Tampering And Repudiation

Threat:
  Param cannot explain who asked, who approved, what ran, or what changed

Controls:

- append-only audit records
- durable events before action
- approval id and actor run id on consequential actions
- file write hashes
- tool call records
- recovery audit events
- redacted but useful logs

## Secrets

Secrets must not be stored in:

- memory
- actor prompts
- skill files
- eval fixtures
- UI specs
- audit details
- visible chat

Secrets may be referenced by:

```text
{ env: "OPENAI_API_KEY" }
{ file: "/etc/param-agent/some-secret" }
```

Actor context can include secret availability, not secret values.

## Security Config

```ts
type SecurityConfig = {
  redaction: {
    enabled: boolean;
    redactSecretsInLogs: boolean;
    redactSecretsInActorContext: boolean;
  };
  network: {
    requireHttpsForRemoteAuth: boolean;
    blockPrivateIpRangesForServerFetch: boolean;
    blockCloudMetadataIp: boolean;
    validateRedirectTargets: boolean;
  };
  mcp: {
    requireReviewForServerChanges: boolean;
    requireNamespacing: boolean;
    storeConfigHash: boolean;
  };
  miniApps: {
    initDataMaxAgeSeconds: number;
    callbackTtlSeconds: number;
    rejectReplay: boolean;
  };
  rateLimits: {
    maxActorRunsPerSessionPerMinute: number;
    maxToolCallsPerRun: number;
    maxConcurrentTaskAgentsGlobal: number;
  };
};
```

## Security Tests

Required tests:

- prompt injection cannot change trust policy
- untrusted tool output cannot execute tools
- raw secret never appears in actor context
- cross-session memory is not retrieved without matching scope
- non-trusted approval does not approve
- replayed approval does not execute
- changed action invalidates approval
- MCP tool names are namespaced
- changed MCP tool metadata requires review
- MCP OAuth redirect URI mismatch is rejected
- server-side fetch blocks cloud metadata IP
- local MCP server command requires explicit approval
- Mini App init data validation rejects forged payload
- Mini App callback replay is rejected
- runtime adapter cannot bypass Param Action Review
- shell command with obfuscation requires manual review or deny
- delivery dedupe prevents duplicate sends after restart

## References

- OWASP Top 10 for LLM Applications: `https://owasp.org/www-project-top-10-for-large-language-model-applications/`
- MCP security best practices: `https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices`
- MCP authorization: `https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization`
- Telegram Mini Apps: `https://core.telegram.org/bots/webapps`
