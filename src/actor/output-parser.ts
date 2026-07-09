import {
  actorOutputDraftSchema,
  type ActorOutputDraft,
} from "../contracts/actor-output";

export type ParseResult = {
  drafts: ActorOutputDraft[];
  errors: string[];
};

/**
 * Parse raw actor output (from a model/runtime) into validated output drafts.
 * Accepts a JSON string (optionally fenced), an array of `{type,payload}`, or
 * an object `{ outputs: [...] }`. Each item is validated against the draft
 * schema; invalid items become errors rather than throwing.
 */
export function parseActorOutputs(raw: unknown): ParseResult {
  const errors: string[] = [];
  let value: unknown = raw;

  if (typeof raw === "string") {
    const cleaned = stripCodeFence(raw).trim();
    if (cleaned.length === 0) {
      return { drafts: [], errors: ["empty output"] };
    }
    try {
      value = JSON.parse(cleaned);
    } catch (error) {
      return {
        drafts: [],
        errors: [`invalid JSON: ${(error as Error).message}`],
      };
    }
  }

  const items = extractItems(value);
  if (items === undefined) {
    return {
      drafts: [],
      errors: ["expected an array of outputs or { outputs: [...] }"],
    };
  }

  const drafts: ActorOutputDraft[] = [];
  items.forEach((item, index) => {
    const parsed = actorOutputDraftSchema.safeParse(item);
    if (parsed.success) {
      drafts.push(parsed.data);
    } else {
      errors.push(`output[${index}]: ${parsed.error.issues[0]?.message ?? "invalid"}`);
    }
  });

  return { drafts, errors };
}

function extractItems(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && "outputs" in value) {
    const outputs = (value as { outputs: unknown }).outputs;
    if (Array.isArray(outputs)) {
      return outputs;
    }
  }
  return undefined;
}

function stripCodeFence(text: string): string {
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/m);
  return fence ? (fence[1] ?? text) : text;
}
