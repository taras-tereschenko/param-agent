import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { MEMORY_CATEGORIES } from "../lib/memory-categories.js";
import { saveMemoryRemote } from "../lib/memory-internal.js";
import { normalizeRequestedMemoryScope } from "../lib/memory/scopes.js";
import { isTrustedTelegramAuth } from "../lib/telegram-auth.js";

const MEMORY_CONTENT_MAX_LENGTH = 600;
const MEMORY_REASON_MAX_LENGTH = 240;
const MEMORY_SCOPE_MAX_LENGTH = 160;
const MEMORY_UPDATES_MAX = 3;
const MEMORY_APPROVAL_INPUT_MAX_LENGTH = 2600;

const updateSchema = z.object({
  category: z.enum(MEMORY_CATEGORIES).describe("Memory category to update"),
  content: z
    .string()
    .min(1)
    .max(MEMORY_CONTENT_MAX_LENGTH)
    .describe("Full replacement prose for this memory category, not a partial delta"),
  scope: z
    .string()
    .min(1)
    .max(MEMORY_SCOPE_MAX_LENGTH)
    .optional()
    .describe(
      "Optional scope. Use principal for private user memory, or the current Telegram chat/topic scope when the memory belongs to that conversation.",
    ),
});

const inputSchema = z
  .object({
    reason: z
      .string()
      .min(1)
      .max(MEMORY_REASON_MAX_LENGTH)
      .describe("Brief reason these facts are worth remembering"),
    updates: z
      .array(updateSchema)
      .min(1)
      .max(MEMORY_UPDATES_MAX)
      .describe("Memory updates to save in one approved batch. Split larger memory proposals into separate approvals."),
  })
  .superRefine((value, ctx) => {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized.length > MEMORY_APPROVAL_INPUT_MAX_LENGTH) {
      ctx.addIssue({
        code: "custom",
        message: "Memory proposal is too large for one exact approval. Split it into smaller approvals.",
      });
    }
  });

export default defineTool({
  description:
    "Propose saving durable Param memory. Use only for stable, useful facts or preferences. Sensitive memory requires approval.",
  inputSchema,
  needsApproval: always(),
  async execute({ reason, updates }, ctx) {
    const auth = ctx.session.auth.current ?? ctx.session.auth.initiator;
    if (!auth?.principalId) {
      return {
        saved: false,
        reason: "Cannot save memory without an authenticated principal",
        results: [],
      };
    }

    if (!isTrustedTelegramAuth(auth)) {
      return {
        saved: false,
        reason: "Only trusted Telegram users can save durable memory right now",
        results: [],
      };
    }

    const results = [];
    for (const update of updates) {
      const normalizedScope = normalizeRequestedMemoryScope(update.scope, auth);
      if (!normalizedScope.scope) {
        results.push({
          category: update.category,
          scope: update.scope,
          saved: false,
          reason: normalizedScope.error,
          allowedScopes: normalizedScope.allowed,
        });
        continue;
      }

      const result = await saveMemoryRemote({
        principalId: auth.principalId,
        category: update.category,
        content: update.content,
        scope: normalizedScope.scope,
        reason,
      });

      results.push({
        category: update.category,
        scope: normalizedScope.scope,
        saved: result.saved,
        reason: result.reason,
      });
    }

    return {
      saved: results.every(result => result.saved),
      results,
    };
  },
});
