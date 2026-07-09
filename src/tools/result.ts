import {
  toolResultPayloadSchema,
  type ToolResultPayload,
} from "../contracts/tool";

const MAX_PREVIEW_CHARS = 500;

/** Build a validated `tool.result` payload. */
export function buildToolResult(input: {
  toolCallId: string;
  toolName: string;
  status: "succeeded" | "failed" | "cancelled" | "blocked";
  output?: Record<string, unknown>;
  textPreview?: string;
  error?: { code: string; message: string };
}): ToolResultPayload {
  return toolResultPayloadSchema.parse({
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    status: input.status,
    output: input.output,
    textPreview: input.textPreview,
    error: input.error,
  });
}

/**
 * Coerce arbitrary tool output into a JSON object plus a short text preview.
 *
 * Tool outputs are UNTRUSTED context: this function never executes or trusts
 * them, it only normalizes shape and truncates the preview.
 */
export function normalizeToolOutput(raw: unknown): {
  output?: Record<string, unknown>;
  textPreview?: string;
} {
  if (raw === undefined || raw === null) {
    return {};
  }

  let output: Record<string, unknown>;
  if (isPlainRecord(raw)) {
    output = raw;
  } else if (Array.isArray(raw)) {
    output = { items: raw };
  } else {
    output = { value: raw };
  }

  return { output, textPreview: truncate(toPreviewText(raw), MAX_PREVIEW_CHARS) };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function toPreviewText(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  try {
    const serialized = JSON.stringify(raw);
    return serialized === undefined ? String(raw) : serialized;
  } catch {
    return String(raw);
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}
