import { describe, expect, it } from "vitest";

import { createTransferWindowOptions } from "./windows";

describe("createTransferWindowOptions", () => {
  it("creates a focused extension transfer popup with only a filename hint", () => {
    const options = createTransferWindowOptions(
      new URL("chrome-extension://abcdefghijklmnop/"),
      "含空格.epub",
      12_345,
    );

    expect(options).toEqual({
      focused: true,
      height: 720,
      type: "popup",
      url: "chrome-extension://abcdefghijklmnop/transfer.html?filename=%E5%90%AB%E7%A9%BA%E6%A0%BC.epub&size=12345",
      width: 440,
    });
    expect(options.url).not.toContain("Downloads");
  });

  it("supports starting a manual transfer without a filename hint", () => {
    expect(
      createTransferWindowOptions(
        new URL("chrome-extension://abcdefghijklmnop/"),
      ).url,
    ).toBe("chrome-extension://abcdefghijklmnop/transfer.html");
  });
});
