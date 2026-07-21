import { describe, expect, it } from "vitest";

import type { StoredTransfer } from "../storage/transfers";
import { getTransferViewState } from "./view-state";

const ACTIVE_TRANSFER: StoredTransfer = {
  transferId: "transfer-1",
  url: "http://192.168.1.10:18321/t/token",
  filename: "book.epub",
  size: 123,
  expiresAt: 2000,
  status: "active",
};

describe("getTransferViewState", () => {
  it("derives active and expired states from the clock", () => {
    expect(getTransferViewState(ACTIVE_TRANSFER, 1999)).toBe("active");
    expect(getTransferViewState(ACTIVE_TRANSFER, 2000)).toBe("expired");
  });

  it("preserves terminal states regardless of expiry", () => {
    expect(
      getTransferViewState({ ...ACTIVE_TRANSFER, status: "completed" }, 3000),
    ).toBe("completed");
    expect(
      getTransferViewState({ ...ACTIVE_TRANSFER, status: "cancelled" }, 1000),
    ).toBe("cancelled");
  });
});
