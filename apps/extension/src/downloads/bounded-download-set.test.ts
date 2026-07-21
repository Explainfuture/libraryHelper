import { describe, expect, it } from "vitest";

import { BoundedDownloadSet } from "./bounded-download-set";

describe("BoundedDownloadSet", () => {
  it("claims each download ID only once", () => {
    const downloads = new BoundedDownloadSet();
    expect(downloads.claim(42)).toBe(true);
    expect(downloads.claim(42)).toBe(false);
    expect(downloads.size).toBe(1);
  });

  it("evicts the least recently seen ID at capacity", () => {
    const downloads = new BoundedDownloadSet(2);
    expect(downloads.claim(1)).toBe(true);
    expect(downloads.claim(2)).toBe(true);
    expect(downloads.claim(1)).toBe(false);
    expect(downloads.claim(3)).toBe(true);
    expect(downloads.size).toBe(2);
    expect(downloads.claim(2)).toBe(true);
    expect(downloads.claim(1)).toBe(true);
  });

  it("can release an ID after an operational failure", () => {
    const downloads = new BoundedDownloadSet();
    downloads.claim(8);
    downloads.release(8);
    expect(downloads.claim(8)).toBe(true);
  });
});
