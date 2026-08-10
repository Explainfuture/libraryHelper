import { describe, expect, it } from "vitest";

import { getFilename } from "./names";

describe("getFilename", () => {
  it("removes Windows and POSIX directory components", () => {
    expect(getFilename(String.raw`C:\Users\reader\Downloads\书.epub`)).toBe(
      "书.epub",
    );
    expect(getFilename("/home/reader/book.epub")).toBe("book.epub");
  });

  it("returns a safe fallback for an empty or trailing path", () => {
    expect(getFilename("")).toBe("book.epub");
    expect(getFilename("C:\\Downloads\\")).toBe("book.epub");
  });
});
