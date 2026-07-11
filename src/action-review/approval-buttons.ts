import type { InlineKeyboardButton } from "../channels/telegram/transport";

/**
 * Inline-button approval: the button carries the approval id, so a tap resolves
 * exactly that approval (unlike a free-text "ok" reply). callback_data must stay
 * under Telegram's 64-byte cap — `ap_approve:<uuid>` is ~47 bytes.
 */
export const APPROVAL_APPROVE_ACTION = "ap_approve";
export const APPROVAL_DENY_ACTION = "ap_deny";

export function buildApprovalKeyboard(approvalId: string): {
  inline_keyboard: InlineKeyboardButton[][];
} {
  return {
    inline_keyboard: [
      [
        {
          text: "✅ Approve",
          callback_data: `${APPROVAL_APPROVE_ACTION}:${approvalId}`,
        },
        {
          text: "🚫 Deny",
          callback_data: `${APPROVAL_DENY_ACTION}:${approvalId}`,
        },
      ],
    ],
  };
}

/**
 * Decode a normalized callback into an approval decision, or undefined if the
 * callback is not an approval button. `value` is the normalizer's coerced value
 * object (a bare remainder becomes `{ value: <remainder> }`).
 */
export function parseApprovalCallback(
  actionId: string,
  value: Record<string, unknown> | undefined,
): { decision: "approved" | "rejected"; approvalId: string } | undefined {
  if (
    actionId !== APPROVAL_APPROVE_ACTION &&
    actionId !== APPROVAL_DENY_ACTION
  ) {
    return undefined;
  }
  const approvalId = typeof value?.value === "string" ? value.value : undefined;
  if (!approvalId) {
    return undefined;
  }
  return {
    decision: actionId === APPROVAL_APPROVE_ACTION ? "approved" : "rejected",
    approvalId,
  };
}
