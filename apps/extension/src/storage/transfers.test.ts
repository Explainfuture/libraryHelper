import { describe, expect, it } from "vitest";

import type { SessionStorageArea } from "./pending-downloads";
import { TRANSFERS_KEY, TransferStore } from "./transfers";

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

describe("TransferStore", () => {
  it("serializes writes, bounds records, and stores no local path", async () => {
    const storage = new MemoryStorage();
    const store = new TransferStore(storage, 2);
    await Promise.all([
      store.save(payload("transfer-1", "one.epub")),
      store.save(payload("transfer-2", "two.epub")),
      store.save(payload("transfer-3", "three.epub")),
    ]);

    const records = await store.list();
    expect(records.map((record) => record.transferId)).toEqual([
      "transfer-2",
      "transfer-3",
    ]);
    expect(JSON.stringify(records)).not.toContain("filePath");
  });

  it("marks completion and cancellation without losing metadata", async () => {
    const storage = new MemoryStorage();
    const store = new TransferStore(storage);
    await store.save(payload("transfer-4", "four.epub"));
    await store.markCompleted("transfer-4");

    await expect(store.get("transfer-4")).resolves.toMatchObject({
      filename: "four.epub",
      status: "completed",
    });
    await store.markCancelled("transfer-4");
    await expect(store.get("transfer-4")).resolves.toMatchObject({
      status: "cancelled",
    });
  });

  it("ignores malformed or non-private stored URLs", async () => {
    const storage = new MemoryStorage();
    storage.values[TRANSFERS_KEY] = [
      {
        ...payload("bad", "bad.epub"),
        url: "https://example.com/book",
        status: "active",
      },
      { unexpected: true },
      { ...payload("transfer-5", "five.epub"), status: "active" },
    ];
    const store = new TransferStore(storage);

    await expect(store.list()).resolves.toEqual([
      { ...payload("transfer-5", "five.epub"), status: "active" },
    ]);
  });

  it("cancels every active record when the runtime pauses", async () => {
    const storage = new MemoryStorage();
    const store = new TransferStore(storage);
    await store.save(payload("transfer-6", "six.epub"));
    await store.save(payload("transfer-7", "seven.epub"));
    await store.markCompleted("transfer-7");

    await expect(store.cancelActive()).resolves.toBe(1);
    await expect(store.list()).resolves.toMatchObject([
      { transferId: "transfer-6", status: "cancelled" },
      { transferId: "transfer-7", status: "completed" },
    ]);
  });
});

function payload(transferId: string, filename: string) {
  return {
    transferId,
    url: `http://192.168.1.10:18321/t/${transferId}`,
    filename,
    size: 123,
    expiresAt: 1_780_000_000_000,
  } as const;
}
