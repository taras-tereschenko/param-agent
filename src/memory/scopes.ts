import type { MemoryScope, MemorySubjectRef } from "../contracts/memory";

/**
 * Memory scope isolation.
 *
 * Memory is scoped by user, group, session, project, and agent. Retrieval must
 * NOT leak across scopes: a DM never surfaces group memory, and a group session
 * never surfaces another user's private memory. Cross-session links stay
 * explicit rather than merging scopes.
 */
export type MemoryRouteType = "dm" | "group" | "topic" | "task" | "ui_surface";

export type MemoryRetrievalContext = {
  routeType: MemoryRouteType;
  sessionId: string;
  paramUserId?: string;
  groupChatId?: string;
  projectId?: string;
};

export type MemoryScopeFilter = {
  scope: MemoryScope;
  subjectRef: MemorySubjectRef;
};

/**
 * Build the allow-list of (scope, subject) filters a session may retrieve.
 * DMs get user + session (+ project); groups get group + session (+ project).
 * Private user memory is never included for a group retrieval, and group memory
 * is never included for a DM retrieval.
 */
export function buildRetrievalScopeFilters(
  ctx: MemoryRetrievalContext,
): MemoryScopeFilter[] {
  const filters: MemoryScopeFilter[] = [
    { scope: "session", subjectRef: { sessionId: ctx.sessionId } },
  ];

  if (ctx.routeType === "dm") {
    if (ctx.paramUserId) {
      filters.push({ scope: "user", subjectRef: { paramUserId: ctx.paramUserId } });
    }
  } else if (ctx.routeType === "group" || ctx.routeType === "topic") {
    if (ctx.groupChatId) {
      filters.push({ scope: "group", subjectRef: { groupChatId: ctx.groupChatId } });
    }
  }

  if (ctx.projectId) {
    filters.push({ scope: "project", subjectRef: { projectId: ctx.projectId } });
  }

  return filters;
}

export type ScopedRecord = {
  scope: MemoryScope | string;
  subjectRef: MemorySubjectRef;
  status?: string;
};

/** Does a stored memory record match any allowed retrieval filter? */
export function recordMatchesFilters(
  record: ScopedRecord,
  filters: MemoryScopeFilter[],
): boolean {
  if (record.status && record.status !== "active") {
    return false;
  }
  return filters.some(
    (filter) =>
      filter.scope === record.scope &&
      subjectRefMatches(filter.scope, filter.subjectRef, record.subjectRef),
  );
}

function subjectRefMatches(
  scope: MemoryScope,
  filterRef: MemorySubjectRef,
  recordRef: MemorySubjectRef,
): boolean {
  switch (scope) {
    case "user":
      return (
        !!filterRef.paramUserId &&
        filterRef.paramUserId === recordRef.paramUserId
      );
    case "group":
      return (
        !!filterRef.groupChatId &&
        filterRef.groupChatId === recordRef.groupChatId
      );
    case "session":
      return (
        !!filterRef.sessionId && filterRef.sessionId === recordRef.sessionId
      );
    case "project":
      return (
        !!filterRef.projectId && filterRef.projectId === recordRef.projectId
      );
    case "agent":
      return (
        !!filterRef.agentType && filterRef.agentType === recordRef.agentType
      );
    default:
      return false;
  }
}
