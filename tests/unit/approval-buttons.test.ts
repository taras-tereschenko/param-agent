import { describe, expect, test } from "bun:test";

import {
  APPROVAL_APPROVE_ACTION,
  APPROVAL_DENY_ACTION,
  buildApprovalKeyboard,
  parseApprovalCallback,
} from "../../src/action-review/approval-buttons";

describe("approval inline buttons", () => {
  test("keyboard carries the approval id and fits Telegram's 64-byte cap", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const [approve, deny] = buildApprovalKeyboard(id).inline_keyboard[0]!;
    expect(approve!.callback_data).toBe(`ap_approve:${id}`);
    expect(deny!.callback_data).toBe(`ap_deny:${id}`);
    expect(approve!.callback_data.length).toBeLessThanOrEqual(64);
    expect(deny!.callback_data.length).toBeLessThanOrEqual(64);
  });

  test("parse maps a normalized callback to a decision + id", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    // The normalizer splits on the first ':' -> actionId + value:{ value: rest }.
    expect(parseApprovalCallback(APPROVAL_APPROVE_ACTION, { value: id })).toEqual({
      decision: "approved",
      approvalId: id,
    });
    expect(parseApprovalCallback(APPROVAL_DENY_ACTION, { value: id })).toEqual({
      decision: "rejected",
      approvalId: id,
    });
  });

  test("ignores non-approval callbacks and missing ids", () => {
    expect(parseApprovalCallback("cb_theme", { value: "x" })).toBeUndefined();
    expect(parseApprovalCallback(APPROVAL_APPROVE_ACTION, {})).toBeUndefined();
    expect(
      parseApprovalCallback(APPROVAL_APPROVE_ACTION, undefined),
    ).toBeUndefined();
  });
});
