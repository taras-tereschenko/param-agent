import { describe, expect, test } from "bun:test";

import {
  buildRetrievalScopeFilters,
  recordMatchesFilters,
} from "../../src/memory/scopes";
import { selectMemories, type StoredMemoryLike } from "../../src/memory/retrieve";
import { rankMemories } from "../../src/memory/rank";
import {
  buildMemoryContextText,
  looksLikeSecret,
  reviewMemoryCandidate,
} from "../../src/memory/review";
import { planCompaction } from "../../src/memory/compaction";
import { cosineSimilarity } from "../../src/memory/embeddings";
import type { MemoryCandidatePayload } from "../../src/contracts/memory";

function record(
  over: Partial<StoredMemoryLike> & Pick<StoredMemoryLike, "id" | "scope" | "subjectRef" | "text">,
): StoredMemoryLike {
  return {
    status: "active",
    confidence: 0.9,
    sensitivity: "low",
    provenanceNote: "test",
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("memory scope isolation", () => {
  const userMem = record({
    id: "m-user",
    scope: "user",
    subjectRef: { paramUserId: "U1" },
    text: "likes espresso",
  });
  const groupMem = record({
    id: "m-group",
    scope: "group",
    subjectRef: { groupChatId: "G1" },
    text: "group inside joke about ducks",
  });

  test("DM retrieval never surfaces group memory", () => {
    const views = selectMemories([userMem, groupMem], {
      routeType: "dm",
      sessionId: "s1",
      paramUserId: "U1",
    }, "espresso ducks");
    const ids = views.map((v) => v.id);
    expect(ids).toContain("m-user");
    expect(ids).not.toContain("m-group");
  });

  test("group retrieval never surfaces private user memory", () => {
    const views = selectMemories([userMem, groupMem], {
      routeType: "group",
      sessionId: "s1",
      groupChatId: "G1",
    }, "espresso ducks");
    const ids = views.map((v) => v.id);
    expect(ids).toContain("m-group");
    expect(ids).not.toContain("m-user");
  });

  test("a different user's memory is not returned", () => {
    const otherUser = record({
      id: "m-other",
      scope: "user",
      subjectRef: { paramUserId: "U2" },
      text: "likes espresso",
    });
    const views = selectMemories([otherUser], {
      routeType: "dm",
      sessionId: "s1",
      paramUserId: "U1",
    }, "espresso");
    expect(views).toHaveLength(0);
  });

  test("filters include session scope but only the matching subject", () => {
    const filters = buildRetrievalScopeFilters({
      routeType: "dm",
      sessionId: "s1",
      paramUserId: "U1",
    });
    expect(filters.some((f) => f.scope === "group")).toBe(false);
    expect(
      recordMatchesFilters(
        { scope: "session", subjectRef: { sessionId: "s1" }, status: "active" },
        filters,
      ),
    ).toBe(true);
    expect(
      recordMatchesFilters(
        { scope: "session", subjectRef: { sessionId: "s2" }, status: "active" },
        filters,
      ),
    ).toBe(false);
  });

  test("forgotten records are excluded", () => {
    const forgotten = record({
      id: "m-forgotten",
      scope: "user",
      subjectRef: { paramUserId: "U1" },
      text: "old fact",
      status: "forgotten",
    });
    const views = selectMemories([forgotten], {
      routeType: "dm",
      sessionId: "s1",
      paramUserId: "U1",
    }, "old fact");
    expect(views).toHaveLength(0);
  });
});

describe("memory ranking", () => {
  test("keyword overlap and confidence influence order", () => {
    const views = rankMemories("coffee espresso order", [
      {
        id: "a",
        scope: "user",
        text: "prefers espresso and dark roast coffee",
        confidence: 0.9,
        sensitivity: "low",
        provenanceNote: "x",
        createdAt: new Date().toISOString(),
      },
      {
        id: "b",
        scope: "user",
        text: "has a dog named rex",
        confidence: 0.9,
        sensitivity: "low",
        provenanceNote: "x",
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(views[0]?.id).toBe("a");
  });
});

describe("memory review", () => {
  test("rejects secrets", () => {
    expect(looksLikeSecret("my api_key is abc")).toBe(true);
    const res = reviewMemoryCandidate(
      candidate({ text: "password is hunter2xxxxxxxxxxxxxxxxxxxxxxxxx" }),
      { fromGroup: false },
    );
    expect(res.decision).toBe("reject");
  });

  test("downgrades group-sourced user-scope candidate to group scope", () => {
    const res = reviewMemoryCandidate(
      candidate({ scope: "user", text: "sam loves pizza" }),
      { fromGroup: true },
    );
    expect(res.decision).toBe("adjust");
    expect(res.candidate.scope).toBe("group");
  });

  test("rejects sensitive low-confidence claims", () => {
    const res = reviewMemoryCandidate(
      candidate({ sensitivity: "high", confidence: 0.2, text: "sam is sick" }),
      { fromGroup: false },
    );
    expect(res.decision).toBe("reject");
  });

  test("context text includes scope + confidence + provenance", () => {
    const text = buildMemoryContextText([
      {
        id: "a",
        scope: "user",
        subject: "U1",
        text: "likes espresso",
        confidence: 0.8,
        sensitivity: "low",
        provenanceNote: "dm on 2026-01-01",
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(text).toContain("user");
    expect(text).toContain("80%");
    expect(text).toContain("dm on 2026-01-01");
  });
});

describe("compaction", () => {
  test("preserves the recent raw tail", () => {
    const events = [1, 2, 3, 4, 5];
    const plan = planCompaction({ events, tailSize: 2 });
    expect(plan.rawTail).toEqual([4, 5]);
    expect(plan.toCompact).toEqual([1, 2, 3]);
  });

  test("keeps everything raw when under the tail size", () => {
    const plan = planCompaction({ events: [1, 2], tailSize: 5 });
    expect(plan.toCompact).toHaveLength(0);
    expect(plan.rawTail).toEqual([1, 2]);
  });
});

describe("embeddings", () => {
  test("cosine similarity of identical vectors is 1", () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1, 5);
  });
  test("orthogonal vectors are 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
});

function candidate(
  over: Partial<MemoryCandidatePayload>,
): MemoryCandidatePayload {
  return {
    candidateId: "c1",
    operation: "create",
    scope: "user",
    text: "some fact",
    confidence: 0.8,
    sensitivity: "low",
    sourceEventIds: ["e1"],
    provenanceNote: "test",
    ...over,
  };
}
