import { z } from "zod";

import { idSchema, jsonObjectSchema } from "./ids";

export const uiSurfaceTargetSchema = z.enum([
  "current_session",
  "telegram_rich_message",
  "mini_app",
]);

export type UiSurfaceTarget = z.infer<typeof uiSurfaceTargetSchema>;

export const uiSchemaNameSchema = z.union([
  z.enum([
    "param.rich_text",
    "param.card",
    "param.form",
    "param.table",
    "param.status",
    "param.mini_app",
  ]),
  z.string().min(1),
]);

export type UiSchemaName = z.infer<typeof uiSchemaNameSchema>;

export const uiThemePatchSchema = z.object({
  system: z.literal("shadcn-css-variables"),
  scope: z.enum(["surface", "session", "profile", "global"]),
  mode: z.enum(["light", "dark", "auto"]).optional(),
  tokens: z.record(z.string(), z.string()).optional(),
  radius: z.string().optional(),
  reason: z.string().optional(),
});

export type UiThemePatch = z.infer<typeof uiThemePatchSchema>;

export const uiCallbackSchema = z.object({
  actionId: z.string().min(1),
  label: z.string().min(1),
  value: jsonObjectSchema.optional(),
  requiresApproval: z.boolean().optional(),
});

export type UiCallback = z.infer<typeof uiCallbackSchema>;

/**
 * `render_ui` output payload. The actor emits validated specs, never raw
 * Telegram HTML or Markdown.
 */
export const renderUiOutputPayloadSchema = z.object({
  surfaceId: idSchema,
  target: uiSurfaceTargetSchema,
  specVersion: z.literal(1),
  schema: uiSchemaNameSchema,
  spec: jsonObjectSchema,
  theme: uiThemePatchSchema.optional(),
  delivery: z
    .object({
      prefer: z
        .enum(["telegram_rich_message", "telegram_message", "mini_app"])
        .optional(),
      allowDraftStreaming: z.boolean().optional(),
      fallback: z
        .array(z.enum(["telegram_message", "mini_app", "artifact"]))
        .optional(),
    })
    .optional(),
  callbacks: z.array(uiCallbackSchema).optional(),
});

export type RenderUiOutputPayload = z.infer<typeof renderUiOutputPayloadSchema>;

/* -------------------------------------------------------------------------- */
/* Spec content schemas (validated by the UI renderer)                        */
/* -------------------------------------------------------------------------- */

export const richTextSpecSchema = z.object({
  blocks: z
    .array(
      z.object({
        kind: z.enum([
          "heading",
          "paragraph",
          "bullet",
          "numbered",
          "code",
          "quote",
          "divider",
          "key_value",
        ]),
        text: z.string().optional(),
        items: z.array(z.string()).optional(),
        pairs: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional(),
      }),
    )
    .min(1),
});

export const statusSpecSchema = z.object({
  title: z.string().optional(),
  rows: z
    .array(
      z.object({
        label: z.string(),
        value: z.string(),
        state: z.enum(["ok", "warn", "error", "info"]).optional(),
      }),
    )
    .min(1),
});

export const tableSpecSchema = z.object({
  title: z.string().optional(),
  columns: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).min(1),
});

export const cardSpecSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  fields: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .optional(),
});

/** Registry of spec content validators keyed by schema name. */
export const uiSpecSchemas: Record<string, z.ZodTypeAny> = {
  "param.rich_text": richTextSpecSchema,
  "param.status": statusSpecSchema,
  "param.table": tableSpecSchema,
  "param.card": cardSpecSchema,
};
