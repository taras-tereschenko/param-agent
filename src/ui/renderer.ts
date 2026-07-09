import {
  renderUiOutputPayloadSchema,
  uiSpecSchemas,
  type RenderUiOutputPayload,
} from "../contracts/ui";
import { validationError } from "../shared/errors";
import { buildCallbackData } from "./callbacks";
import {
  cardToTelegram,
  richTextToTelegram,
  statusToTelegram,
  tableToTelegram,
  type CardSpec,
  type RichTextSpec,
  type StatusSpec,
  type TableSpec,
} from "./telegram/render";

export type RenderTarget =
  | "telegram_rich_message"
  | "telegram_message"
  | "mini_app";

export type RenderedSurface = {
  surfaceId: string;
  target: RenderTarget;
  telegram?: {
    text: string;
    inlineButtons?: { text: string; callbackData: string }[];
  };
  miniApp?: { url?: string; payload: Record<string, unknown> };
  callbacks: {
    actionId: string;
    callbackData: string;
    requiresApproval: boolean;
  }[];
};

/**
 * Deterministic UI renderer. Validates the actor's `render_ui` payload, then
 * the spec against its registered schema (when known), and maps it to a channel
 * surface with durable, validated callback metadata. Unknown-but-string schemas
 * render generically instead of failing.
 */
export function renderUi(payload: RenderUiOutputPayload): RenderedSurface {
  const parsed = renderUiOutputPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw validationError("invalid render_ui payload", {
      issues: parsed.error.issues,
    });
  }
  const output = parsed.data;

  const specSchema = uiSpecSchemas[output.schema];
  if (specSchema) {
    const specResult = specSchema.safeParse(output.spec);
    if (!specResult.success) {
      throw validationError(`invalid spec for schema ${output.schema}`, {
        schema: output.schema,
        issues: specResult.error.issues,
      });
    }
  }

  const text = specToText(output.schema, output.spec);
  const target = resolveTarget(output);

  const callbacks = (output.callbacks ?? []).map((callback) => ({
    actionId: callback.actionId,
    label: callback.label,
    callbackData: buildCallbackData(
      output.surfaceId,
      callback.actionId,
      callback.value,
    ),
    requiresApproval: callback.requiresApproval ?? false,
  }));

  const surface: RenderedSurface = {
    surfaceId: output.surfaceId,
    target,
    callbacks: callbacks.map((callback) => ({
      actionId: callback.actionId,
      callbackData: callback.callbackData,
      requiresApproval: callback.requiresApproval,
    })),
  };

  if (target === "mini_app") {
    surface.miniApp = { payload: output.spec };
    return surface;
  }

  const telegram: NonNullable<RenderedSurface["telegram"]> = { text };
  // Plain telegram_message fallback carries the same text but no buttons.
  if (target === "telegram_rich_message" && callbacks.length > 0) {
    telegram.inlineButtons = callbacks.map((callback) => ({
      text: callback.label,
      callbackData: callback.callbackData,
    }));
  }
  surface.telegram = telegram;
  return surface;
}

function resolveTarget(output: RenderUiOutputPayload): RenderTarget {
  const prefer = output.delivery?.prefer;
  if (prefer) return prefer;
  if (output.target === "mini_app") return "mini_app";
  return "telegram_rich_message";
}

function specToText(schema: string, spec: Record<string, unknown>): string {
  switch (schema) {
    case "param.rich_text":
      return richTextToTelegram(spec as RichTextSpec);
    case "param.status":
      return statusToTelegram(spec as StatusSpec);
    case "param.table":
      return tableToTelegram(spec as TableSpec);
    case "param.card":
      return cardToTelegram(spec as CardSpec);
    default:
      return genericToTelegram(spec);
  }
}

/** Safe, readable fallback for arbitrary (unregistered) spec schemas. */
function genericToTelegram(spec: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(spec)) {
    if (value === null || typeof value !== "object") {
      lines.push(`${key}: ${String(value)}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join("\n");
}
