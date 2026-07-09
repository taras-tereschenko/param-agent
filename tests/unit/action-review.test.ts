import { describe, expect, test } from "bun:test";

import { classifyRisk } from "../../src/action-review/classify";
import {
  chooseApprovers,
  computeProposalHash,
  decideActionReview,
  proposalChanged,
  riskAtMost,
} from "../../src/action-review/policy";
import {
  isTrustedForScope,
  scopeSatisfies,
  trustedApproversInChat,
  type ResolvedTrustedUser,
} from "../../src/action-review/trusted-users";

describe("risk classification", () => {
  test("safe_read tool is non-consequential; server tool is critical", () => {
    expect(
      classifyRisk({ actionKind: "tool_call", toolRiskLevel: "safe_read" })
        .consequential,
    ).toBe(false);
    const server = classifyRisk({
      actionKind: "tool_call",
      toolRiskLevel: "server",
    });
    expect(server.risk).toBe("critical");
    expect(server.requiredTrustScope).toBe("server_admin");
  });

  test("server_action is critical, config_change high", () => {
    expect(classifyRisk({ actionKind: "server_action" }).risk).toBe("critical");
    expect(classifyRisk({ actionKind: "config_change" }).risk).toBe("high");
  });
});

describe("trust scoping", () => {
  const trusted: ResolvedTrustedUser[] = [
    { platform: "telegram", platformUserId: "owner", scopes: [{ scope: "global" }] },
    {
      platform: "telegram",
      platformUserId: "chatmod",
      scopes: [{ scope: "chat", platform: "telegram", chatId: "-100" }],
    },
  ];

  test("global scope satisfies any requirement", () => {
    expect(
      scopeSatisfies({ scope: "global" }, "server_admin", {
        platform: "telegram",
      }),
    ).toBe(true);
  });

  test("chat-scoped trust only applies to its chat", () => {
    expect(
      isTrustedForScope("chatmod", "chat", { platform: "telegram", chatId: "-100" }, trusted),
    ).toBe(true);
    expect(
      isTrustedForScope("chatmod", "chat", { platform: "telegram", chatId: "-999" }, trusted),
    ).toBe(false);
    // chat-scoped trust is not server_admin
    expect(
      isTrustedForScope("chatmod", "server_admin", { platform: "telegram" }, trusted),
    ).toBe(false);
  });

  test("owner (global) is trusted for chat + server_admin", () => {
    expect(
      isTrustedForScope("owner", "server_admin", { platform: "telegram" }, trusted),
    ).toBe(true);
  });

  test("trustedApproversInChat filters participants by trust", () => {
    const present = trustedApproversInChat(
      "chat",
      { platform: "telegram", chatId: "-100" },
      ["randomuser", "chatmod", "owner"],
      trusted,
    );
    expect(present).toContain("chatmod");
    expect(present).toContain("owner");
    expect(present).not.toContain("randomuser");
  });
});

describe("action review policy", () => {
  test("unverified sender is denied", () => {
    const d = decideActionReview({
      classification: classifyRisk({ actionKind: "config_change" }),
      requesterVerified: false,
      requesterTrustedInScope: true,
      isSafeAutoRun: false,
    });
    expect(d.decision).toBe("denied");
  });

  test("non-trusted requester of a consequential action needs approval", () => {
    const d = decideActionReview({
      classification: classifyRisk({ actionKind: "send_external_message" }),
      requesterVerified: true,
      requesterTrustedInScope: false,
      isSafeAutoRun: false,
    });
    expect(d.decision).toBe("needs_approval");
  });

  test("trusted-in-scope requester auto-runs medium-risk actions", () => {
    const d = decideActionReview({
      classification: classifyRisk({ actionKind: "schedule_create" }),
      requesterVerified: true,
      requesterTrustedInScope: true,
      isSafeAutoRun: false,
    });
    expect(d.decision).toBe("auto_allowed");
    expect(d.reasonCode).toBe("trusted_auto_review_in_scope");
  });

  test("critical actions still need approval even for trusted users", () => {
    const d = decideActionReview({
      classification: classifyRisk({ actionKind: "server_action" }),
      requesterVerified: true,
      requesterTrustedInScope: true,
      isSafeAutoRun: false,
    });
    expect(d.decision).toBe("needs_approval");
  });

  test("safe read-only actions auto-allow", () => {
    const d = decideActionReview({
      classification: classifyRisk({
        actionKind: "tool_call",
        toolRiskLevel: "safe_read",
      }),
      requesterVerified: true,
      requesterTrustedInScope: false,
      isSafeAutoRun: true,
    });
    expect(d.decision).toBe("auto_allowed");
  });

  test("riskAtMost ordering", () => {
    expect(riskAtMost("medium", "high")).toBe(true);
    expect(riskAtMost("critical", "medium")).toBe(false);
  });
});

describe("approver routing + exact proposal", () => {
  test("in-chat approvers preferred, DM fallback when none present", () => {
    expect(
      chooseApprovers({
        trustedApproverIdsInChat: ["chatmod"],
        configuredDmApproverIds: ["owner"],
      }).mode,
    ).toBe("in_chat");
    expect(
      chooseApprovers({
        trustedApproverIdsInChat: [],
        configuredDmApproverIds: ["owner"],
      }).mode,
    ).toBe("dm");
  });

  test("proposal hash detects an exact-proposal change", () => {
    const original = { tool: "shell", cmd: "ls" };
    const hash = computeProposalHash(original);
    expect(proposalChanged(hash, { tool: "shell", cmd: "ls" })).toBe(false);
    expect(proposalChanged(hash, { tool: "shell", cmd: "rm -rf /" })).toBe(true);
  });
});
