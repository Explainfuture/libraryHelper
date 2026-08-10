import { describe, expect, it } from "vitest";

import { createReceiverURL } from "./sender";

describe("createReceiverURL", () => {
  it("keeps pairing credentials in the receiver page fragment", () => {
    const url = createReceiverURL(
      new URL("https://example.test/libraryHelper/"),
      "sender-id",
      "secret token",
    );

    expect(url).toBe(
      "https://example.test/libraryHelper/#/receive?peer=sender-id&token=secret+token",
    );
    expect(new URL(url).search).toBe("");
  });
});
