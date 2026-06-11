# Param Agent Skills

This file defines how Param uses skills.

## Decision

Param uses skills.sh as the default skills ecosystem.

Skills are procedural knowledge for the actor and task agents. They are not
permissions, plugins, or automatic tool grants.

```text
skills.sh
  -> discover skill metadata
  -> review source and audits
  -> install into Param skill store
  -> index metadata
  -> load only relevant skill content into context
```

## What Skills Are

Skills help Param do a kind of work better.

Examples:

- frontend design
- shadcn usage
- PDF handling
- research workflows
- GitHub workflows
- deployment procedures
- database best practices

Skills can include instructions, examples, scripts, and supporting files.

Skills should improve judgment and procedure. They should not silently add new
authority.

## Source Of Truth

Param's skill registry is the source of truth for what is installed, enabled,
trusted, and available in a session.

skills.sh is the default catalog and installer source.

Runtime-specific skill stores are derived from Param's registry. If Codex,
OpenCode, Antigravity, or another runtime has its own skills location, the
runtime adapter can mirror approved skills there.

The actor should not install skills directly into random runtime directories.

## Discovery

Discovery can use:

- skills.sh search API
- skills.sh leaderboard API
- skills.sh curated API
- explicit user request
- local installed skill metadata

Search results should first enter Param as metadata:

- id
- slug
- name
- source
- install URL
- skills.sh URL
- install count
- duplicate flag, if present
- audit status, if available

Do not load full skill files into actor context until a skill is selected for
review or use.

## Installation

The official skills.sh install path is the `skills` CLI.

Example:

```text
npx skills add vercel-labs/agent-skills
```

Param's Bun deployment can use `bunx` as the configured runner while keeping the
same `skills add` command shape.

Param should wrap this in its installer/runtime policy:

- use a configured package runner
- run from a controlled working directory
- set `DISABLE_TELEMETRY=1` by default unless the owner opts in
- install into the Param-managed skill store
- record installed file hashes
- record installed source and version metadata
- never overwrite local skill changes without review

Installing or updating a skill changes Param's behavior, so it is a
state-changing action. It requires Action Review.

## Storage

Recommended layout:

```text
/var/lib/param-agent/skills/
  installed/
    <source>/<slug>/
  cache/
    skills-sh/
  index/
```

The database stores:

- skill id
- source
- slug
- name
- install URL
- local path
- content hash
- installed at
- installed by
- trust status
- enabled status
- allowed sessions/scopes
- required tools declared by the skill
- last audit status
- last reviewed at

## Trust

skills.sh has security audit information for some skills, but skills are still
third-party content.

Trust states:

```text
unreviewed
trusted
restricted
disabled
blocked
```

Default policy:

- official or curated skills still need first install review
- unaudited skills require stronger review
- failed/high-risk audits are blocked unless manually overridden by a trusted
  server admin
- duplicate or forked skills are hidden by default unless explicitly requested
- skills from unknown sources start restricted

Trust is scoped. A skill can be trusted for one task type but not for server
management, private data, or group chat use.

## Loading Into Context

Skills should be loaded progressively.

1. Actor receives only relevant skill names and short descriptions.
2. If a skill seems useful, Context Builder loads the skill summary or top
   section.
3. Full `SKILL.md` and supporting files are loaded only when needed.
4. Scripts/examples are referenced by path and loaded only when the actor or a
   task agent needs them.

This prevents context bloat.

## Selection

Skill selection is deterministic ranking plus actor choice.

Context Builder can rank candidates by:

- explicit user request
- current task type
- channel/session scope
- installed/enabled status
- skill tags
- previous successful use
- required tools
- trust status
- recency of audit

The actor decides which ranked skill is actually useful.

## Skills And Tools

Skills can declare tool needs.

They cannot grant tools.

Example:

```text
skill says it needs shell access
  -> Param records required tool: shell.run
  -> Tool Registry checks whether shell.run exists
  -> Action Review checks whether this run can use it
  -> approval may be required
```

This rule is important:

```text
skills are advice
tools are capability
Action Review gates side effects
```

## Skill Use By Task Agents

Task agents can receive skills too.

The Session Actor can spawn a task agent with:

- allowed skill ids
- required skill ids
- forbidden skill ids
- tool policy
- budget
- output contract

Task agents should not discover and install new skills on their own unless the
Session Actor proposes that action and Action Review approves it.

## Skill Updates

Skill updates are state changes.

Update flow:

1. Check latest metadata/hash from skills.sh.
2. Compare with installed hash.
3. Fetch audit status.
4. Show diff or review summary.
5. Ask for trusted approval.
6. Install update.
7. Re-index metadata.
8. Record audit event.

If update changes declared tool needs, the skill returns to restricted until
reviewed.

## Local Skills

Param can support local private skills.

Local skills are useful for:

- owner-specific procedures
- server-specific runbooks
- personal preferences
- private project workflows

Local skills are not uploaded to skills.sh.

They still go through the same registry, trust, scope, and loading rules.

## Config

```ts
type SkillsConfig = {
  enabled: boolean;
  provider: "skills.sh";
  installCommand: {
    runner: "npx" | "bunx";
    packageName: "skills";
  };
  paths: {
    installedDir: string;
    cacheDir: string;
  };
  telemetry: {
    disableSkillsCliTelemetry: boolean;
  };
  discovery: {
    useApi: boolean;
    preferCurated: boolean;
    hideDuplicates: boolean;
    maxResults: number;
  };
  trust: {
    requireReviewBeforeInstall: boolean;
    requireReviewBeforeEnable: boolean;
    blockFailedAudits: boolean;
    allowUnauditedSkills: "never" | "manual_review" | "allowed_restricted";
  };
  context: {
    maxSkillSummaries: number;
    maxFullSkillsPerRun: number;
    maxSkillBytesPerRun: number;
  };
};
```

## Tests

Skills tests should cover:

- search returns metadata only
- duplicate skills are hidden when configured
- install requires Action Review
- telemetry opt-out env is applied
- audit fail blocks install or enable
- installed hash is recorded
- skill update changes hash and creates audit event
- full skill content is loaded only when selected
- skill cannot grant tool permission
- task agent receives only allowed skills
- disabled skill is never loaded into context

## References

- skills.sh docs: `https://www.skills.sh/docs`
- skills.sh CLI: `https://www.skills.sh/docs/cli`
- skills.sh API: `https://www.skills.sh/docs/api`
- skills.sh FAQ: `https://www.skills.sh/docs/faq`
