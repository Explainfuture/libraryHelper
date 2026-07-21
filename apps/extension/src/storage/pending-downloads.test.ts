import { describe, expect, it } from "vitest";

import {
  PENDING_DOWNLOADS_KEY,
  PendingDownloadQueue,
  type SessionStorageArea,
} from "./pending-downloads";

class MemoryStorage implements SessionStorageArea {
  readonly values: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    await Promise.resolve();
    return { [key]: this.values[key] };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    await Promise.resolve();
    Object.assign(this.values, items);
  }
}

describe("PendingDownloadQueue", () => {
  it("serializes concurrent appends and keeps the configured bound", async () => {
    const storage = new MemoryStorage();
    const queue = new PendingDownloadQueue(storage, 2);
    await Promise.all([
      queue.enqueue({ downloadId: 1, filePath: "one.epub", detectedAt: 1 }),
      queue.enqueue({ downloadId: 2, filePath: "two.epub", detectedAt: 2 }),
      queue.enqueue({ downloadId: 3, filePath: "three.epub", detectedAt: 3 }),
    ]);

    await expect(queue.read()).resolves.toEqual([
      { downloadId: 2, filePath: "two.epub", detectedAt: 2 },
      { downloadId: 3, filePath: "three.epub", detectedAt: 3 },
    ]);
  });

  it("replaces a repeated ID and ignores malformed stored values", async () => {
    const storage = new MemoryStorage();
    storage.values[PENDING_DOWNLOADS_KEY] = [{ downloadId: "bad" }];
    const queue = new PendingDownloadQueue(storage);
    await queue.enqueue({ downloadId: 4, filePath: "old.epub", detectedAt: 1 });
    await queue.enqueue({ downloadId: 4, filePath: "new.epub", detectedAt: 2 });

    await expect(queue.read()).resolves.toEqual([
      { downloadId: 4, filePath: "new.epub", detectedAt: 2 },
    ]);
  });

  it("serializes removals with appends", async () => {
    const storage = new MemoryStorage();
    const queue = new PendingDownloadQueue(storage);
    await Promise.all([
      queue.enqueue({ downloadId: 5, filePath: "five.epub", detectedAt: 1 }),
      queue.enqueue({ downloadId: 6, filePath: "six.epub", detectedAt: 2 }),
      queue.remove(5),
    ]);

    await expect(queue.read()).resolves.toEqual([
      { downloadId: 6, filePath: "six.epub", detectedAt: 2 },
    ]);
    await expect(queue.remove(-1)).rejects.toBeInstanceOf(RangeError);
  });
});
