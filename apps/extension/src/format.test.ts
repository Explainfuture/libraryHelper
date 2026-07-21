import { describe, expect, it } from "vitest";

import { formatFileSize, getCountdown } from "./format";

describe("formatFileSize", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KiB"],
    [1_572_864, "1.5 MiB"],
    [1_073_741_824, "1.0 GiB"],
  ])("formats %d bytes as %s", (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });

  it("rejects invalid sizes", () => {
    expect(() => formatFileSize(-1)).toThrow(RangeError);
    expect(() => formatFileSize(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("getCountdown", () => {
  it("rounds partial seconds up", () => {
    expect(getCountdown(61_001, 1000)).toEqual({
      expired: false,
      label: "1 分 1 秒",
      remainingSeconds: 61,
    });
  });

  it("marks elapsed links as expired", () => {
    expect(getCountdown(999, 1000)).toEqual({
      expired: true,
      label: "链接已失效",
      remainingSeconds: 0,
    });
  });
});
