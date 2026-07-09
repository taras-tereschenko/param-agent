import type { LatestContext } from "./inference";

/** Minimal event view the context builder needs (keeps this module pure). */
export type ContextEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  source: Record<string, unknown>;
  occurredAt: string | Date;
};

export type BuiltContext = {
  latest?: LatestContext;
  knownEventIds: string[];
  sessionContextText: string;
};

/**
 * Build actor context from recent session events (chronological order). Pure:
 * the worker loads events from the DB and passes them in. Always keep a recent
 * raw tail; compaction/summaries are layered separately.
 */
export function buildContext(
  events: ContextEvent[],
  options: { tail?: number } = {},
): BuiltContext {
  const tail = options.tail ?? 30;
  const recent = events.slice(-tail);
  const knownEventIds = recent.map((event) => event.id);
  const latest = extractLatest(recent);
  const sessionContextText = renderTranscript(recent);
  return { latest, knownEventIds, sessionContextText };
}

export function extractLatest(events: ContextEvent[]): LatestContext | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || event.type !== "chat.message.received") {
      continue;
    }
    const payload = event.payload as {
      text?: string;
      mechanical?: {
        mentionsParam?: boolean;
        repliesToParam?: boolean;
        isDirectMessage?: boolean;
        isGroupMessage?: boolean;
      };
    };
    const source = event.source as {
      displayName?: string;
      username?: string;
    };
    return {
      text: payload.text,
      fromDisplayName: source.displayName ?? source.username,
      mentionsParam: payload.mechanical?.mentionsParam,
      repliesToParam: payload.mechanical?.repliesToParam,
      isDirectMessage: payload.mechanical?.isDirectMessage,
      isGroupMessage: payload.mechanical?.isGroupMessage,
      latestEventId: event.id,
    };
  }
  return undefined;
}

export function renderTranscript(events: ContextEvent[]): string {
  const lines: string[] = [];
  for (const event of events) {
    if (event.type === "chat.message.received") {
      const payload = event.payload as { text?: string };
      const source = event.source as {
        displayName?: string;
        username?: string;
        kind?: string;
      };
      const who =
        source.kind === "param"
          ? "param"
          : (source.displayName ?? source.username ?? "user");
      lines.push(`${who}: ${payload.text ?? "(non-text message)"}`);
    }
  }
  if (lines.length === 0) {
    return "Recent conversation:\n(no recent chat messages)";
  }
  return `Recent conversation:\n${lines.join("\n")}`;
}

export function buildSteeringText(
  steering: { priority: string; text?: string }[],
): string {
  if (steering.length === 0) {
    return "";
  }
  const lines = steering.map(
    (item) => `- [${item.priority}] ${item.text ?? "(non-text activity)"}`,
  );
  return [
    "Live steering (same-session activity since this run started):",
    ...lines,
    "",
    "Hard controls must be obeyed. Strong steering may mean the current plan is",
    "stale; reassess before replying.",
  ].join("\n");
}
