import type {
  MemoryCandidatePayload,
  MemoryView,
} from "../contracts/memory";

export type MemoryReviewContext = {
  /** The candidate's source conversation is a group. */
  fromGroup: boolean;
};

export type MemoryReviewResult = {
  decision: "accept" | "adjust" | "reject";
  candidate: MemoryCandidatePayload;
  reason: string;
};

const SECRET_PATTERNS = [
  /\b(api[_-]?key|secret|password|passwd|token|bearer)\b/i,
  /\b[A-Za-z0-9_-]{32,}\b/, // long opaque token-like string
  /\bsk-[A-Za-z0-9]{16,}\b/,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Review a memory candidate before it becomes durable memory:
 * - never store secrets as memory
 * - do not turn group gossip into a private-user fact (downgrade scope)
 * - do not store sensitive low-confidence claims
 * Preserve provenance and uncertainty; scope stays explicit.
 */
export function reviewMemoryCandidate(
  candidate: MemoryCandidatePayload,
  ctx: MemoryReviewContext,
): MemoryReviewResult {
  if (looksLikeSecret(candidate.text)) {
    return {
      decision: "reject",
      candidate,
      reason: "looks like a secret; secrets are never stored as memory",
    };
  }

  if (candidate.sensitivity === "high" && candidate.confidence < 0.5) {
    return {
      decision: "reject",
      candidate,
      reason: "sensitive claim with low confidence",
    };
  }

  // Group gossip must not silently become a private-user fact.
  if (ctx.fromGroup && candidate.scope === "user") {
    return {
      decision: "adjust",
      candidate: { ...candidate, scope: "group" },
      reason: "group-sourced claim downgraded from user scope to group scope",
    };
  }

  return { decision: "accept", candidate, reason: "accepted" };
}

/** Render retrieved memory for the actor, always with provenance + confidence. */
export function buildMemoryContextText(views: MemoryView[]): string {
  if (views.length === 0) {
    return "";
  }
  return views
    .map((view) => {
      const conf = Math.round(view.confidence * 100);
      const subject = view.subject ? ` about ${view.subject}` : "";
      return `- (${view.scope}${subject}, ${conf}% conf, src: ${view.provenanceNote}) ${view.text}`;
    })
    .join("\n");
}
