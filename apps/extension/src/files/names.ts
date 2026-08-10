export function getFilename(filePath: string): string {
  const parts = filePath.split(/[\\/]/u);
  return parts.at(-1) || "book.epub";
}
