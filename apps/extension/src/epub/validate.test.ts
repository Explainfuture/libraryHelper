import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";

import { validateEpub } from "./validate";

describe("validateEpub", () => {
  it("accepts an EPUB with mimetype and container metadata", async () => {
    const file = await createArchive([
      ["mimetype", "application/epub+zip"],
      ["META-INF/container.xml", "<container />"],
    ]);

    await expect(validateEpub(file)).resolves.toEqual({ ok: true });
  });

  it("rejects an archive without the EPUB container", async () => {
    const file = await createArchive([["mimetype", "application/epub+zip"]]);

    await expect(validateEpub(file)).resolves.toEqual({
      ok: false,
      message: "EPUB 缺少 META-INF/container.xml。",
    });
  });

  it("rejects a non-EPUB filename before opening the archive", async () => {
    const file = new File(["not a zip"], "book.txt", { type: "text/plain" });
    await expect(validateEpub(file)).resolves.toEqual({
      ok: false,
      message: "请选择扩展名为 .epub 的文件。",
    });
  });
});

async function createArchive(
  entries: ReadonlyArray<readonly [name: string, contents: string]>,
): Promise<File> {
  const writer = new ZipWriter(new BlobWriter("application/epub+zip"));
  for (const [name, contents] of entries) {
    await writer.add(name, new TextReader(contents));
  }
  const blob = await writer.close();
  return new File([blob], "book.epub", { type: "application/epub+zip" });
}
