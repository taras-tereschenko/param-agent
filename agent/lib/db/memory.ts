import { and, asc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "./client.js";
import { paramMemories, paramProfiles, type ParamMemory, type ParamProfile } from "./schema.js";
import type { MemoryCategory } from "../memory-categories.js";
import { memoryOwnerPrincipalId } from "../memory/scopes.js";

export interface UpsertProfileInput {
  readonly principalId: string;
  readonly displayName?: string;
  readonly timezone?: string;
  readonly locale?: string;
  readonly bio?: string;
}

export interface SaveMemoryInput {
  readonly principalId: string;
  readonly category: MemoryCategory;
  readonly content: string;
  readonly scope?: string;
  readonly source?: string;
  readonly confidence?: number;
  readonly provenance?: string;
  readonly metadata?: Record<string, unknown>;
}

export function normalizeMemoryContent(content: string) {
  return content.trim().replace(/\s+/g, " ");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableJson(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

export async function getOrCreateProfile(input: UpsertProfileInput): Promise<ParamProfile> {
  const insertValues = {
    principalId: input.principalId,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    ...(input.bio === undefined ? {} : { bio: input.bio }),
  };

  const [created] = await getDb()
    .insert(paramProfiles)
    .values(insertValues)
    .onConflictDoNothing()
    .returning();

  if (created) {
    return created;
  }

  const updateValues = {
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    ...(input.bio === undefined ? {} : { bio: input.bio }),
  };

  if (Object.keys(updateValues).length > 0) {
    const [updated] = await getDb()
      .update(paramProfiles)
      .set({ ...updateValues, updatedAt: new Date() })
      .where(eq(paramProfiles.principalId, input.principalId))
      .returning();

    if (updated) return updated;
  }

  const [existing] = await getDb()
    .select()
    .from(paramProfiles)
    .where(eq(paramProfiles.principalId, input.principalId))
    .limit(1);

  if (!existing) {
    throw new Error("Failed to create or load Param profile");
  }

  return existing;
}

export async function getProfile(principalId: string): Promise<ParamProfile> {
  return getOrCreateProfile({ principalId });
}

export async function findProfile(principalId: string): Promise<ParamProfile | undefined> {
  const [profile] = await getDb()
    .select()
    .from(paramProfiles)
    .where(eq(paramProfiles.principalId, principalId))
    .limit(1);

  return profile;
}

export async function listMemoriesForPrincipal(input: {
  readonly principalId: string;
  readonly scopes?: readonly string[];
}): Promise<ParamMemory[]> {
  const scopes = Array.from(new Set(["principal", ...(input.scopes ?? [])]));
  const scopedOwners = scopes
    .filter(scope => scope !== "principal")
    .map(scope => memoryOwnerPrincipalId(input.principalId, scope));
  const sharedScopes = scopes.filter(scope => scope !== "principal");

  const conditions = [
    and(eq(paramMemories.principalId, input.principalId), inArray(paramMemories.scope, scopes)),
  ];

  if (scopedOwners.length > 0) {
    conditions.push(
      and(inArray(paramMemories.principalId, scopedOwners), inArray(paramMemories.scope, sharedScopes)),
    );
  }

  return getDb()
    .select()
    .from(paramMemories)
    .where(or(...conditions))
    .orderBy(asc(paramMemories.scope), asc(paramMemories.category));
}

export async function saveMemory(input: SaveMemoryInput) {
  const scope = input.scope?.trim() || "principal";
  const content = input.content.trim();
  if (!content) {
    throw new Error("Memory content cannot be empty");
  }

  const ownerPrincipalId = memoryOwnerPrincipalId(input.principalId, scope);
  const source = input.source ?? "agent";
  const confidence = input.confidence ?? 1;
  const metadata = input.metadata ?? {};

  await getProfile(ownerPrincipalId);

  const existing = await getDb()
    .select()
    .from(paramMemories)
    .where(
      and(
        eq(paramMemories.principalId, ownerPrincipalId),
        eq(paramMemories.scope, scope),
        eq(paramMemories.category, input.category),
      ),
    )
    .limit(1);

  if (
    existing[0]
    && normalizeMemoryContent(existing[0].content) === normalizeMemoryContent(content)
    && existing[0].source === source
    && existing[0].confidence === confidence
    && (existing[0].provenance ?? undefined) === input.provenance
    && stableJson(existing[0].metadata) === stableJson(metadata)
  ) {
    return { saved: false as const, reason: "unchanged" as const, entry: existing[0] };
  }

  const now = new Date();
  const [entry] = await getDb()
    .insert(paramMemories)
    .values({
      principalId: ownerPrincipalId,
      scope,
      category: input.category,
      content,
      source,
      confidence,
      provenance: input.provenance,
      metadata,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [paramMemories.principalId, paramMemories.scope, paramMemories.category],
      set: {
        content,
        source,
        confidence,
        provenance: input.provenance,
        metadata,
        updatedAt: now,
      },
    })
    .returning();

  if (!entry) {
    throw new Error("Failed to save Param memory");
  }

  return { saved: true as const, entry };
}
