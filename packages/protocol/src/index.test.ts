import { describe, expect, it } from "vitest";

import { parseReceiverMessage, parseSenderMessage } from "./index";

describe("WebRTC transfer protocol", () => {
  it("accepts strict receiver control messages", () => {
    expect(parseReceiverMessage({ type: "hello", token: "secret" })).toEqual({
      type: "hello",
      token: "secret",
    });
    expect(parseReceiverMessage({ type: "ack", nextChunk: 2 })).toEqual({
      type: "ack",
      nextChunk: 2,
    });
    expect(
      parseReceiverMessage({ type: "hello", token: "secret", extra: true }),
    ).toBeNull();
  });

  it("accepts binary chunks and rejects malformed metadata", () => {
    const data = new Uint8Array([1, 2, 3]);
    const parsed = parseSenderMessage({ type: "chunk", index: 0, data });
    expect(parsed?.type).toBe("chunk");
    if (parsed?.type === "chunk") {
      expect([...new Uint8Array(parsed.data)]).toEqual([1, 2, 3]);
    }
    expect(
      parseSenderMessage({
        type: "metadata",
        filename: "book.epub",
        mime: "application/epub+zip",
        size: -1,
        chunkSize: 1024,
        totalChunks: 1,
      }),
    ).toBeNull();
  });
});
