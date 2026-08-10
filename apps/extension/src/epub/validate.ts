import { MAX_EPUB_BYTES } from "@bookbridge/protocol";

const EPUB_MIME = "application/epub+zip";
const MAX_ARCHIVE_ENTRIES = 20_000;

export interface EpubValidationResult {
  ok: boolean;
  message?: string;
}

export async function validateEpub(file: File): Promise<EpubValidationResult> {
  if (!file.name.toLocaleLowerCase("en-US").endsWith(".epub")) {
    return { ok: false, message: "请选择扩展名为 .epub 的文件。" };
  }
  if (file.size === 0) {
    return { ok: false, message: "这个文件是空的。" };
  }
  if (file.size > MAX_EPUB_BYTES) {
    return { ok: false, message: "当前版本最多传输 256 MiB 的 EPUB。" };
  }

  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!hasZipSignature(signature)) {
    return { ok: false, message: "这个文件不是有效的 EPUB/ZIP 文件。" };
  }

  const { BlobReader, TextWriter, ZipReader } = await import("@zip.js/zip.js");
  const reader = new ZipReader(new BlobReader(file));
  try {
    const entries = await reader.getEntries();
    if (entries.length === 0 || entries.length > MAX_ARCHIVE_ENTRIES) {
      return { ok: false, message: "EPUB 的归档结构不受支持。" };
    }
    if (entries.some((entry) => entry.encrypted)) {
      return { ok: false, message: "暂不支持加密的 EPUB 文件。" };
    }
    const container = entries.find(
      (entry) =>
        entry.filename === "META-INF/container.xml" && !entry.directory,
    );
    if (container === undefined) {
      return { ok: false, message: "EPUB 缺少 META-INF/container.xml。" };
    }

    const mimetype = entries.find(
      (entry) => entry.filename === "mimetype" && !entry.directory,
    );
    if (
      mimetype === undefined ||
      mimetype.uncompressedSize > 128 ||
      !("getData" in mimetype) ||
      typeof mimetype.getData !== "function"
    ) {
      return { ok: false, message: "EPUB 缺少有效的 mimetype 文件。" };
    }
    const value = await mimetype.getData(new TextWriter("utf-8"));
    if (value.trim() !== EPUB_MIME) {
      return { ok: false, message: "EPUB 的 mimetype 声明无效。" };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "无法读取 EPUB 的归档结构。" };
  } finally {
    await reader.close();
  }
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length === 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  );
}
