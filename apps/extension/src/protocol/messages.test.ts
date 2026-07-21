import { describe, expect, it } from "vitest";

import {
  cancelTransferRequest,
  createTransferRequest,
  parseNativeMessage,
} from "./messages";

describe("native protocol", () => {
  it("builds strict requests with the provided request ID", () => {
    expect(
      createTransferRequest(
        String.raw`C:\Downloads\book.epub`,
        12,
        "request-1",
      ),
    ).toEqual({
      type: "CREATE_TRANSFER",
      requestId: "request-1",
      payload: {
        filePath: String.raw`C:\Downloads\book.epub`,
        downloadId: 12,
      },
    });
    expect(cancelTransferRequest("transfer-1", "request-2")).toEqual({
      type: "CANCEL_TRANSFER",
      requestId: "request-2",
      payload: { transferId: "transfer-1" },
    });
  });

  it.each([
    {
      type: "TRANSFER_CREATED",
      requestId: "request-1",
      payload: {
        transferId: "transfer-1",
        url: "http://192.168.1.42:18321/t/token",
        filename: "示例.epub",
        size: 123,
        expiresAt: 1_780_000_000_000,
      },
    },
    {
      type: "TRANSFER_CANCELLED",
      requestId: "request-2",
      payload: { transferId: "transfer-1" },
    },
    {
      type: "TRANSFER_COMPLETED",
      requestId: "transfer-1",
      payload: { transferId: "transfer-1" },
    },
    {
      type: "ERROR",
      requestId: "request-3",
      error: { code: "INVALID_EPUB", message: "invalid" },
    },
  ])("accepts valid $type messages", (message) => {
    expect(parseNativeMessage(message)).toEqual(message);
  });

  it.each([
    null,
    { type: "TRANSFER_CREATED", requestId: "request", payload: {} },
    {
      type: "TRANSFER_CREATED",
      requestId: "request",
      payload: {
        transferId: "transfer",
        url: "https://remote.example/t/token",
        filename: "book.epub",
        size: 1,
        expiresAt: 2,
      },
    },
    {
      type: "TRANSFER_CREATED",
      requestId: "request",
      payload: {
        transferId: "transfer",
        url: "http://remote.example/t/token",
        filename: "book.epub",
        size: 1,
        expiresAt: 2,
      },
    },
    {
      type: "TRANSFER_COMPLETED",
      requestId: "request",
      payload: { transferId: "transfer", extra: true },
    },
    {
      type: "ERROR",
      requestId: "request",
      error: { code: "FAIL", message: "failed", extra: true },
    },
    { type: "UNKNOWN", requestId: "request", payload: {} },
  ])("rejects invalid message %#", (message) => {
    expect(parseNativeMessage(message)).toBeNull();
  });
});
