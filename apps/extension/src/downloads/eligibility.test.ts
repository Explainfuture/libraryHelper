import { describe, expect, it } from "vitest";

import {
  hasEpubExtension,
  hasEpubMime,
  isEligibleEpub,
  isPartialDownload,
} from "./eligibility";

describe("EPUB eligibility", () => {
  it.each([
    "book.epub",
    "BOOK.EPUB",
    String.raw`C:\Users\reader\Downloads\示例.EpUb`,
  ])("recognizes EPUB extension for %s", (filename) => {
    expect(hasEpubExtension(filename)).toBe(true);
  });

  it.each(["book.pdf", "epub", "book.epub.zip"])(
    "rejects non-EPUB extension for %s",
    (filename) => {
      expect(hasEpubExtension(filename)).toBe(false);
    },
  );

  it.each([
    "application/epub+zip",
    "APPLICATION/EPUB+ZIP",
    "application/epub+zip; charset=binary",
  ])("recognizes EPUB MIME for %s", (mime) => {
    expect(hasEpubMime(mime)).toBe(true);
  });

  it.each([undefined, "application/zip", "text/plain"])(
    "rejects non-EPUB MIME for %s",
    (mime) => {
      expect(hasEpubMime(mime)).toBe(false);
    },
  );

  it.each(["book.epub.crdownload", "book.EPUB.PART", "book.tmp"])(
    "recognizes partial download suffix for %s",
    (filename) => {
      expect(isPartialDownload(filename)).toBe(true);
      expect(isEligibleEpub({ filename, mime: "application/epub+zip" })).toBe(
        false,
      );
    },
  );

  it("allows MIME detection when the final extension is absent", () => {
    expect(
      isEligibleEpub({
        filename: "downloaded-book",
        mime: "application/epub+zip",
      }),
    ).toBe(true);
  });
});
