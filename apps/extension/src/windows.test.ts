import { describe, expect, it } from "vitest";

import { createTransferWindowOptions } from "./windows";

describe("createTransferWindowOptions", () => {
  it("creates the requested popup without exposing a local path", () => {
    const options = createTransferWindowOptions(
      "chrome-extension://extension-id/transfer.html",
      "transfer/含空格",
    );

    expect(options).toEqual({
      focused: true,
      height: 560,
      type: "popup",
      url: "chrome-extension://extension-id/transfer.html?transferId=transfer%2F%E5%90%AB%E7%A9%BA%E6%A0%BC",
      width: 420,
    });
    expect(options.url).not.toContain("Downloads");
  });

  it("rejects an empty transfer ID", () => {
    expect(() =>
      createTransferWindowOptions(
        "chrome-extension://extension-id/transfer.html",
        "",
      ),
    ).toThrow(TypeError);
  });
});
