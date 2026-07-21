import type { EligibleDownload } from "../downloads/coordinator";

export const PENDING_DOWNLOADS_KEY = "bookbridge.pendingDownloads";
const DEFAULT_CAPACITY = 16;

export interface PendingDownload extends EligibleDownload {
  detectedAt: number;
}

export interface SessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

// Serializes storage updates so simultaneous download events cannot overwrite
// one another. The queue is bounded and lives only in chrome.storage.session.
export class PendingDownloadQueue {
  readonly #capacity: number;
  readonly #storage: SessionStorageArea;
  #tail: Promise<void> = Promise.resolve();

  constructor(storage: SessionStorageArea, capacity = DEFAULT_CAPACITY) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError("capacity must be a positive safe integer");
    }
    this.#storage = storage;
    this.#capacity = capacity;
  }

  enqueue(download: PendingDownload): Promise<void> {
    const operation = this.#tail.then(() => this.#append(download));
    this.#tail = operation.catch(() => undefined);
    return operation;
  }

  async read(): Promise<readonly PendingDownload[]> {
    await this.#tail;
    const values = await this.#storage.get(PENDING_DOWNLOADS_KEY);
    return parsePendingDownloads(values[PENDING_DOWNLOADS_KEY]);
  }

  async #append(download: PendingDownload): Promise<void> {
    const values = await this.#storage.get(PENDING_DOWNLOADS_KEY);
    const existing = parsePendingDownloads(
      values[PENDING_DOWNLOADS_KEY],
    ).filter((candidate) => candidate.downloadId !== download.downloadId);
    existing.push(download);
    await this.#storage.set({
      [PENDING_DOWNLOADS_KEY]: existing.slice(-this.#capacity),
    });
  }
}

function parsePendingDownloads(value: unknown): PendingDownload[] {
  if (!isUnknownArray(value)) {
    return [];
  }
  const downloads: PendingDownload[] = [];
  for (const candidate of value) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "downloadId" in candidate &&
      "filePath" in candidate &&
      "detectedAt" in candidate &&
      typeof candidate.downloadId === "number" &&
      Number.isSafeInteger(candidate.downloadId) &&
      candidate.downloadId >= 0 &&
      typeof candidate.filePath === "string" &&
      candidate.filePath !== "" &&
      typeof candidate.detectedAt === "number" &&
      Number.isSafeInteger(candidate.detectedAt) &&
      candidate.detectedAt >= 0
    ) {
      downloads.push({
        downloadId: candidate.downloadId,
        filePath: candidate.filePath,
        detectedAt: candidate.detectedAt,
      });
    }
  }
  return downloads;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
