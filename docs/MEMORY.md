# Param Agent Memory

This file defines Param's persistent memory system.

Core principle:

```text
Param remembers like a socially careful friend, not like surveillance software.
```

## Memory Is Not History

Param has three related but different context systems:

```text
events
  what happened

summaries
  compressed context for long sessions

memory
  useful facts, preferences, norms, and commitments worth carrying forward
```

Raw chat history is not memory. Memory is selected, scoped, provenance-aware
context.

The actor should see memory as evidence, not absolute truth.

## Memory Scopes

```text
user
  about one person: preferences, stable facts, communication style, recurring
  needs

group
  about one group: norms, shared jokes, decisions, recurring topics

session
  useful only inside one chat, thread, topic, task, or UI surface

project
  product, architecture, codebase, and implementation decisions

agent
  Param's own operating preferences, self-management lessons, and long-term
  behavior notes
```

Scope decides where memory can be retrieved. A memory from one scope should not
silently leak into another.

## What To Remember

Good memory candidates:

- stable user preferences
- important personal facts users willingly share
- group norms
- shared jokes and recurring references
- project decisions
- ongoing commitments
- recurring tasks
- names, aliases, and relationships when useful
- communication preferences
- things Param promised
- corrections users make
- safety-relevant preferences
- schedule or notification preferences

Examples:

```text
Taras prefers architecture docs to be split into focused files.
```

```text
This group likes sarcastic one-liners but dislikes spammy bot chatter.
```

```text
Param promised to revisit runtime adapter contracts after memory docs.
```

## What Not To Remember

Avoid memory for:

- secrets, tokens, passwords, API keys, connection strings
- raw chat logs
- one-off drama
- insults as stable identity
- group gossip as private user fact
- private facts from the wrong session
- every casual preference
- accidental typos or throwaway jokes
- sensitive claims without clear value and scope
- medical, legal, financial, or safety-sensitive claims unless explicitly useful
  and carefully scoped

When unsure, prefer no memory candidate or a lower-confidence scoped candidate.

## Candidate Lifecycle

Memory starts as a candidate.

```text
1. Conversation event is stored.
2. Memory review runs.
3. Review actor emits memory_candidate outputs.
4. Memory system validates candidates.
5. Candidate is merged, rejected, queued, updated, or converted into forget.
6. Memory record is written or changed.
7. Retrieval can show the memory later with provenance.
```

Candidate operations:

```text
create
  add new memory

update
  change or refine existing memory

forget
  remove, suppress, or expire existing memory
```

Candidate shape lives in `docs/CONTRACTS.md`.

Example:

```ts
{
  operation: "create",
  scope: "user",
  text: "Taras prefers architecture docs to be split and easy to scan.",
  confidence: 0.86,
  sensitivity: "low",
  sourceEventIds: ["evt_123"],
  provenanceNote: "Taras said this while discussing docs structure."
}
```

## Automatic Memory Review

Memory review should run automatically.

Triggers:

- after a chat quiets down
- after long actor runs
- before and after compaction
- on scheduled background review
- after explicit "remember this"
- after correction such as "no, that's wrong"
- after task agents return memory candidates
- after project or architecture decisions

Memory review turn allowed outputs:

```text
memory_candidate
run_summary
done
```

Memory review should not send visible chat messages.

## Explicit Memory Requests

Users can steer memory directly:

```text
remember this
don't remember that
forget what i said about x
that's wrong
update that
```

Param should respond naturally in chat when useful, but the durable change still
goes through memory candidates.

Example visible response:

```text
got you
```

Then internally:

```text
memory_candidate(operation: "create")
```

## Group Claims Rule

Group claims need provenance.

If Alice says in a group:

```text
John is always late.
```

Do not store:

```text
user memory: John is always late.
```

Better options:

```text
no memory
```

or:

```text
group memory: Alice claimed in group X that John is often late.
subject: John
source: Alice
confidence: low
scope: group
```

The key rule:

```text
Do not turn group gossip into private user memory.
```

## Sensitivity

Memory candidates and records use sensitivity:

```text
low
  ordinary preferences, project choices, group norms

medium
  personal details, relationship context, private preferences

high
  sensitive personal data, security-relevant facts, health/legal/financial
  context, anything that could harm someone if shown in the wrong place
```

High-sensitivity memory needs stricter retrieval and audit.

Secrets are not high-sensitivity memory. Secrets are not memory at all.

## Memory Retrieval

Before actor runs, retrieve relevant memory from:

- session memory
- group memory
- user memory for active participants
- project memory when the chat is project-related
- agent memory when it affects Param's operation
- recent events and summaries

Ranking should combine:

- scope match
- semantic similarity through pgvector
- keyword match through Postgres full-text search
- recency
- confidence
- source reliability
- current participants
- sensitivity policy
- explicit user corrections

Retrieval should prefer fewer high-quality memories over dumping many records.

## Actor Memory Display

Show memory to the actor with provenance.

Good shape:

```text
memory:
- id: mem_123
  scope: user
  subject: Taras
  confidence: 0.9
  sensitivity: low
  source: DM, 2026-06-09
  text: Prefers concise docs with focused files instead of wall-of-text docs.
```

Bad shape:

```text
Taras prefers concise docs.
```

The actor needs scope and provenance to use memory safely.

## Memory Use Enforcement

Memory must be part of the actor input contract, not optional decoration.

The Context Builder should always include a memory packet before actor runs.
When no memory is relevant, the packet should still say that clearly:

```text
relevant_memory: []
```

This prevents actors and runtime adapters from quietly skipping memory
retrieval.

The actor should not recite memory. It should let memory shape the decision:

- whether to reply
- what tone fits this person or group
- whether a topic is already settled
- whether a promise or open loop matters
- whether a tool, task agent, or no_reply is more appropriate

Actor run summaries should record memory usage internally:

```ts
{
  memoryUsed: ["mem_123", "mem_456"],
  ignoredMemory: [
    {
      id: "mem_789",
      reason: "Low confidence and contradicted by recent messages."
    }
  ]
}
```

This is not visible chat text. It exists so tests, debug views, and memory
review can catch cases where useful memory was retrieved but ignored.

Enforcement points:

- Context Builder always emits a memory section.
- Prompt Compiler includes memory-use instructions for actor runs.
- Session Actor emits internal memory usage in `run_summary`.
- Validators reject malformed memory usage metadata.
- Evaluation tests check that known memory changes behavior when relevant.

## Using Memory In Chat

Param should use memory naturally.

Good:

```text
yeah let's keep this as a separate doc
```

Bad:

```text
I remember that you prefer separate documents, so I will now...
```

Memory use should feel like a friend remembering context, not a database
announce.

## Updating Memory

When new information conflicts with old memory:

- create an update candidate
- preserve source events
- lower confidence if uncertainty remains
- avoid overwriting sensitive memory without audit
- do not pretend contradictions are resolved when they are not

Example:

```text
old: Taras wants no Docker.
new: Taras is okay with Docker for isolated experiments.
candidate: update project memory with narrower scope.
```

## Forgetting Memory

Forget requests should be respected.

Forgetting can mean:

```text
delete
  remove memory record when policy allows

suppress
  keep audit but do not retrieve

expire
  mark memory no longer active after time

replace
  supersede with corrected memory
```

The system should preserve audit for important changes, especially shared or
trusted-state-adjacent memory.

User private forget requests should not require group approval.

Group-wide memory changes may require trusted approval if they affect other
users or shared policy.

## Privacy Boundaries

Rules:

- DM memory does not automatically appear in groups.
- Group memory does not automatically become private user memory.
- Project memory is visible only in project-relevant contexts.
- Agent memory should not expose private user details.
- Trusted users cannot silently rewrite another user's private memory without
  audit.
- Secrets are never memory.
- Tool outputs are untrusted and should not become memory without review.

## Cross-Channel Identity

The same person may appear across multiple channels.

Memory should link through Param user identity only when identity is known or
trusted.

Do not assume two accounts are the same person from display name alone.

Cross-channel memory retrieval should require:

- explicit identity link
- trusted config
- or user confirmation

## Storage Mapping

Primary tables:

- `memory_records`
- `memory_candidates`
- `memory_links`
- `events`
- `summaries`
- `audit_log`

Search:

- pgvector for semantic similarity
- Postgres full-text search for keyword match
- normal indexes for scope, subject, status, sensitivity

## Config Mapping

Relevant config:

- memory enabled
- embedding model
- embedding dimensions
- review triggers
- scheduled review interval
- retrieval limits
- retention policy
- sensitivity policy

`embeddingDimensions` must match the database vector column dimension.

## Prompt Mapping

Prompt contracts:

- Memory Review Turn creates candidates.
- Memory Context Layer shows scoped memory with provenance.
- Normal Chat Turn receives a memory packet even when it is empty.
- Normal Chat Turn can emit memory candidates.
- Run Summary records which retrieved memories were used or ignored.
- Compaction Turn can emit memory handoff candidates.

Prompt details live in `docs/PROMPTS.md`.

## Action Review Mapping

Memory changes can require Action Review when they:

- modify shared group memory
- modify project memory with broad impact
- affect another user's private memory
- delete or suppress audited memory
- involve sensitive claims

Normal low-sensitivity personal preferences shared by the user can usually go
through review/merge without manual approval.

## Observability

Memory audit should explain:

- why a candidate was created
- source events
- who or what created it
- scope
- confidence
- sensitivity
- review result
- retrieval usage, when useful for debugging
- updates and forgets

User-visible memory controls should be simple:

```text
remember this
forget that
what do you remember about me
```

Responses should still sound like Param.

## Tests

Required tests:

- explicit "remember this" creates a candidate
- ordinary preference becomes low-sensitivity scoped memory
- secret-like text is rejected as memory
- group gossip stays group-scoped or is rejected
- correction updates old memory
- forget request suppresses old memory from retrieval
- DM memory does not appear in group context
- group memory appears only in that group/session
- memory review runs after quiet period
- compaction preserves memory handoff notes
- retrieval includes provenance and confidence
- low-confidence memory is phrased carefully to the actor
- cross-channel identity is not inferred from display name alone
