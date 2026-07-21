import { describe, expect, it } from "vitest";

import { parseCancelTransferCommand, parseRuntimeResponse } from "./messages";

describe("extension runtime messages", () => {
  it("accepts a strict cancellation command", () => {
    expect(
      parseCancelTransferCommand({
        type: "CANCEL_TRANSFER",
        transferId: "transfer-1",
      }),
    ).toEqual({ type: "CANCEL_TRANSFER", transferId: "transfer-1" });
  });

  it.each([
    null,
    { type: "CANCEL_TRANSFER", transferId: "" },
    { type: "CANCEL_TRANSFER", transferId: "transfer-1", extra: true },
    { type: "OTHER", transferId: "transfer-1" },
  ])("rejects an invalid cancellation command %#", (value) => {
    expect(parseCancelTransferCommand(value)).toBeNull();
  });

  it("parses strict success and error responses", () => {
    expect(parseRuntimeResponse({ ok: true })).toEqual({ ok: true });
    expect(
      parseRuntimeResponse({
        ok: false,
        error: { code: "CANCEL_FAILED", message: "取消失败" },
      }),
    ).toEqual({
      ok: false,
      error: { code: "CANCEL_FAILED", message: "取消失败" },
    });
    expect(parseRuntimeResponse({ ok: true, extra: true })).toBeNull();
  });
});
