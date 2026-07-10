import { passesStyle } from "../../src/actor/style-guard";
import type { EvalScenario } from "../types";

/** Deterministic voice + ambient-judgment scenarios (MockActor). */
export const ambientVoiceScenarios: EvalScenario[] = [
  {
    id: "greeting-gets-greeting",
    description: "a bare 'hey' in a DM gets a short greeting, not a briefing",
    runType: "normal_chat",
    latest: { text: "hey", isDirectMessage: true, latestEventId: "e1" },
    expect: (turn) => {
      if (turn.visibleMessages.length !== 1) return "expected one reply";
      if (turn.visibleMessages[0]!.text.length > 40) return "reply too long";
      return null;
    },
  },
  {
    id: "busy-group-stays-quiet",
    description: "ambient group chatter not addressing Param stays quiet",
    runType: "normal_chat",
    latest: {
      text: "anyway lunch soon?",
      isGroupMessage: true,
      mentionsParam: false,
      latestEventId: "e1",
    },
    expect: (turn) =>
      turn.stayedQuiet ? null : "expected no reply in a busy group",
  },
  {
    id: "visible-output-is-param-voiced",
    description: "any delivered message passes the style guard",
    runType: "normal_chat",
    latest: { text: "thanks!", isDirectMessage: true, latestEventId: "e1" },
    expect: (turn) =>
      turn.visibleMessages.every((m) => passesStyle(m.text))
        ? null
        : "a delivered message failed the style guard",
  },
];
