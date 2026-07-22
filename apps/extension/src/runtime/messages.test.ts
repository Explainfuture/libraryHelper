import { describe, expect, it } from "vitest";

import {
  parseCancelTransferCommand,
  parseGetRuntimeStateCommand,
  parseRuntimeResponse,
  parseRuntimeStateResponse,
  parseSetEnabledCommand,
} from "./messages";

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

  it("accepts strict runtime state commands", () => {
    expect(parseGetRuntimeStateCommand({ type: "GET_RUNTIME_STATE" })).toEqual({
      type: "GET_RUNTIME_STATE",
    });
    expect(
      parseSetEnabledCommand({ type: "SET_ENABLED", enabled: false }),
    ).toEqual({ type: "SET_ENABLED", enabled: false });
    expect(
      parseSetEnabledCommand({
        type: "SET_ENABLED",
        enabled: false,
        extra: true,
      }),
    ).toBeNull();
  });

  it("parses strict runtime state responses", () => {
    expect(
      parseRuntimeStateResponse({
        ok: true,
        state: {
          enabled: true,
          serverState: "stopped",
          activeTransferCount: 0,
        },
      }),
    ).toEqual({
      ok: true,
      state: {
        enabled: true,
        serverState: "stopped",
        activeTransferCount: 0,
      },
    });
    expect(
      parseRuntimeStateResponse({
        ok: true,
        state: {
          enabled: true,
          serverState: "starting",
          activeTransferCount: 0,
        },
      }),
    ).toBeNull();
  });
});
