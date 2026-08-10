import { describe, expect, it } from "vitest";

import { parseRoute } from "./routes";

describe("BookBridge routes", () => {
  it("parses a valid receiver route", () => {
    expect(parseRoute("#/receive?peer=a&token=b")).toEqual({
      kind: "receive",
      peerId: "a",
      token: "b",
    });
  });

  it("rejects pages that were not opened from a pairing QR code", () => {
    expect(parseRoute("")).toEqual({ kind: "invalid" });
    expect(parseRoute("#/send")).toEqual({ kind: "invalid" });
    expect(parseRoute("#/receive?peer=a")).toEqual({ kind: "invalid" });
  });
});
