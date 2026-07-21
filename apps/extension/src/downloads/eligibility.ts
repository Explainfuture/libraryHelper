const EPUB_EXTENSION = ".epub";
const EPUB_MIME = "application/epub+zip";
const PARTIAL_SUFFIXES = [".crdownload", ".part", ".tmp"] as const;

export interface DownloadCandidate {
  filename: string;
  mime?: string;
}

export function hasEpubExtension(filename: string): boolean {
  return filename.toLocaleLowerCase("en-US").endsWith(EPUB_EXTENSION);
}

export function hasEpubMime(mime: string | undefined): boolean {
  if (mime === undefined) {
    return false;
  }
  const [mediaType] = mime.split(";", 1);
  return mediaType?.trim().toLocaleLowerCase("en-US") === EPUB_MIME;
}

export function isPartialDownload(filename: string): boolean {
  const lowerFilename = filename.toLocaleLowerCase("en-US");
  return PARTIAL_SUFFIXES.some((suffix) => lowerFilename.endsWith(suffix));
}

export function isEligibleEpub(candidate: DownloadCandidate): boolean {
  if (candidate.filename === "" || isPartialDownload(candidate.filename)) {
    return false;
  }
  return hasEpubExtension(candidate.filename) || hasEpubMime(candidate.mime);
}
