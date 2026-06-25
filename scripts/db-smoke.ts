import "dotenv/config";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { getDb } from "../agent/lib/db/client.js";
import { findProfile, getOrCreateProfile, listMemoriesForPrincipal, saveMemory } from "../agent/lib/db/memory.js";
import { paramProfiles } from "../agent/lib/db/schema.js";
import { buildParamContextPrompt } from "../agent/lib/memory-internal.js";

const principalId = `param-smoke:${randomUUID()}`;
const otherPrincipalId = `param-smoke:${randomUUID()}`;
const sharedScope = `telegram:smoke-${randomUUID()}`;
const sharedOwnerPrincipalId = `scope:${sharedScope}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const db = getDb();

  try {
    const profile = await getOrCreateProfile({
      principalId,
      displayName: "Param DB Smoke",
      timezone: "UTC",
      locale: "en",
      bio: "temporary smoke-test profile",
    });

    const privateMemory = await saveMemory({
      principalId,
      category: "projects",
      content: "Param DB smoke test can save private memory.",
      provenance: "scripts/db-smoke.ts",
    });

    const sharedMemory = await saveMemory({
      principalId,
      category: "group_norms",
      content: "Param DB smoke test can save shared chat memory.",
      scope: sharedScope,
      provenance: "scripts/db-smoke.ts",
    });

    const memories = await listMemoriesForPrincipal({
      principalId,
      scopes: [sharedScope],
    });
    const otherPrincipalMemories = await listMemoriesForPrincipal({
      principalId: otherPrincipalId,
      scopes: [sharedScope],
    });
    const loadedProfile = await findProfile(principalId);

    assert(profile.principalId === principalId, "profile did not round-trip");
    assert(loadedProfile?.displayName === "Param DB Smoke", "profile was not loaded from the database");
    assert(privateMemory.saved, "private memory was not saved");
    assert(sharedMemory.saved, "shared memory was not saved");
    assert(sharedMemory.entry.principalId === sharedOwnerPrincipalId, "shared memory was not stored under shared owner");
    assert(
      memories.some(memory => memory.category === "projects" && memory.scope === "principal"),
      "private memory was not retrieved",
    );
    assert(
      memories.some(memory => memory.category === "group_norms" && memory.scope === sharedScope),
      "shared scoped memory was not retrieved",
    );
    assert(
      otherPrincipalMemories.some(memory => memory.category === "group_norms" && memory.scope === sharedScope),
      "shared scoped memory was not retrieved by another principal",
    );
    assert(
      !otherPrincipalMemories.some(memory => memory.category === "projects" && memory.scope === "principal"),
      "private memory leaked to another principal",
    );

    const prompt = buildParamContextPrompt({
      profile: {
        displayName: loadedProfile.displayName ?? undefined,
        timezone: loadedProfile.timezone,
        locale: loadedProfile.locale,
        bio: loadedProfile.bio,
      },
      memory: memories.map(memory => ({
        category: memory.category,
        content: memory.content,
        scope: memory.scope,
        confidence: memory.confidence,
        provenance: memory.provenance ?? undefined,
      })),
    });

    assert(prompt.includes("untrusted factual context"), "context prompt did not include memory safety framing");
    assert(prompt.includes("Param DB Smoke"), "context prompt omitted loaded profile");
    assert(prompt.includes("Param DB smoke test can save private memory."), "context prompt omitted private memory");
    assert(prompt.includes("Param DB smoke test can save shared chat memory."), "context prompt omitted shared memory");

    console.log("db smoke ok");
    console.log(`profile: ${principalId}`);
    console.log(`shared scope: ${sharedScope}`);
    console.log(`memories loaded: ${memories.length}`);
  } finally {
    await db.delete(paramProfiles)
      .where(inArray(paramProfiles.principalId, [principalId, sharedOwnerPrincipalId]));
  }
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
