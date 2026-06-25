import { defineChannel, GET, POST } from "eve/channels";
import { z } from "zod";
import { findProfile, listMemoriesForPrincipal, saveMemory } from "../lib/db/memory.js";
import { MEMORY_CATEGORIES } from "../lib/memory-categories.js";

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function requireInternalRequest(request: Request) {
  const secret = process.env.PARAM_INTERNAL_API_SECRET?.trim();
  if (!secret) {
    return json({ error: "PARAM_INTERNAL_API_SECRET is not configured" }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return json({ error: "unauthorized" }, { status: 401 });
  }

  return undefined;
}

const contextQuerySchema = z.object({
  principalId: z.string().trim().min(1),
  scope: z.string().trim().min(1).optional(),
});

const saveMemoryBodySchema = z.object({
  principalId: z.string().trim().min(1),
  category: z.enum(MEMORY_CATEGORIES),
  content: z.string().trim().min(1),
  scope: z.string().trim().min(1).optional(),
  reason: z.string().trim().min(1).optional(),
  source: z.enum(["agent", "manual", "import", "review"]).default("agent"),
  confidence: z.number().min(0).max(1).default(1),
  provenance: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export default defineChannel({
  routes: [
    GET("/api/internal/param-context", async request => {
      const denied = requireInternalRequest(request);
      if (denied) return denied;

      const url = new URL(request.url);
      const parsed = contextQuerySchema.safeParse({
        principalId: url.searchParams.get("principalId"),
        scope: url.searchParams.get("scope") ?? undefined,
      });

      if (!parsed.success) {
        return json({ error: "invalid query", issues: parsed.error.issues }, { status: 400 });
      }

      const [profile, memory] = await Promise.all([
        findProfile(parsed.data.principalId),
        listMemoriesForPrincipal({
          principalId: parsed.data.principalId,
          scopes: parsed.data.scope ? [parsed.data.scope] : undefined,
        }),
      ]);

      return json({
        profile: {
          displayName: profile?.displayName ?? undefined,
          timezone: profile?.timezone ?? "UTC",
          locale: profile?.locale ?? "en",
          bio: profile?.bio ?? "",
        },
        memory: memory.map(entry => ({
          category: entry.category,
          content: entry.content,
          scope: entry.scope,
          confidence: entry.confidence,
          provenance: entry.provenance ?? undefined,
        })),
      });
    }),
    POST("/api/internal/memory", async request => {
      const denied = requireInternalRequest(request);
      if (denied) return denied;

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid json" }, { status: 400 });
      }

      const parsed = saveMemoryBodySchema.safeParse(body);
      if (!parsed.success) {
        return json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
      }

      const result = await saveMemory({
        principalId: parsed.data.principalId,
        category: parsed.data.category,
        content: parsed.data.content,
        scope: parsed.data.scope,
        source: parsed.data.source,
        confidence: parsed.data.confidence,
        provenance: parsed.data.provenance ?? parsed.data.reason,
        metadata: {
          ...parsed.data.metadata,
          ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
        },
      });

      return json({
        saved: result.saved,
        reason: result.reason,
        entry: {
          id: result.entry.id,
          category: result.entry.category,
          scope: result.entry.scope,
          content: result.entry.content,
          source: result.entry.source,
          confidence: result.entry.confidence,
          provenance: result.entry.provenance ?? undefined,
        },
      });
    }),
  ],
});
