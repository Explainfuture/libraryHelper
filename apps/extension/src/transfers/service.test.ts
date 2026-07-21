import { describe, expect, it, vi } from "vitest";

import type { TransferCreatedMessage } from "../protocol/messages";
import { TransferService } from "./service";

const CREATED_MESSAGE: TransferCreatedMessage = {
  type: "TRANSFER_CREATED",
  requestId: "request-1",
  payload: {
    transferId: "transfer-1",
    url: "http://192.168.1.10:18321/t/token",
    filename: "book.epub",
    size: 123,
    expiresAt: 1_780_000_000_000,
  },
};

describe("TransferService", () => {
  it("queues, creates, stores, and removes a completed handoff in order", async () => {
    const calls: string[] = [];
    const service = new TransferService({
      nativeClient: {
        createTransfer: () => {
          calls.push("create");
          return Promise.resolve(CREATED_MESSAGE);
        },
        cancelTransfer: () => Promise.reject(new Error("not used")),
      },
      pendingDownloads: {
        enqueue: (download) => {
          calls.push(`enqueue:${download.detectedAt.toString()}`);
          return Promise.resolve();
        },
        remove: () => {
          calls.push("remove");
          return Promise.resolve();
        },
      },
      transfers: {
        save: () => {
          calls.push("save");
          return Promise.resolve();
        },
        markCancelled: () => Promise.resolve(),
        markCompleted: () => Promise.resolve(),
      },
      now: () => 42,
    });

    await expect(
      service.create({ downloadId: 8, filePath: "C:/Downloads/book.epub" }),
    ).resolves.toEqual(CREATED_MESSAGE);
    expect(calls).toEqual(["enqueue:42", "create", "save", "remove"]);
  });

  it("removes pending metadata while preserving a native failure", async () => {
    const nativeError = new Error("native failed");
    const remove = vi.fn(() => Promise.resolve());
    const service = new TransferService({
      nativeClient: {
        createTransfer: () => Promise.reject(nativeError),
        cancelTransfer: () => Promise.reject(new Error("not used")),
      },
      pendingDownloads: {
        enqueue: () => Promise.resolve(),
        remove,
      },
      transfers: {
        save: () => Promise.resolve(),
        markCancelled: () => Promise.resolve(),
        markCompleted: () => Promise.resolve(),
      },
    });

    await expect(
      service.create({ downloadId: 9, filePath: "C:/Downloads/book.epub" }),
    ).rejects.toBe(nativeError);
    expect(remove).toHaveBeenCalledWith(9);
  });

  it("persists asynchronous completion events", async () => {
    const markCompleted = vi.fn(() => Promise.resolve());
    const service = new TransferService({
      nativeClient: {
        createTransfer: () => Promise.resolve(CREATED_MESSAGE),
        cancelTransfer: () => Promise.reject(new Error("not used")),
      },
      pendingDownloads: {
        enqueue: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      transfers: {
        save: () => Promise.resolve(),
        markCancelled: () => Promise.resolve(),
        markCompleted,
      },
    });

    await service.complete({
      type: "TRANSFER_COMPLETED",
      requestId: "transfer-1",
      payload: { transferId: "transfer-1" },
    });
    expect(markCompleted).toHaveBeenCalledWith("transfer-1");
  });

  it("cancels through the native client before updating storage", async () => {
    const calls: string[] = [];
    const service = new TransferService({
      nativeClient: {
        createTransfer: () => Promise.resolve(CREATED_MESSAGE),
        cancelTransfer: (transferId) => {
          calls.push(`native:${transferId}`);
          return Promise.resolve({
            type: "TRANSFER_CANCELLED",
            requestId: "request-2",
            payload: { transferId },
          });
        },
      },
      pendingDownloads: {
        enqueue: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      transfers: {
        save: () => Promise.resolve(),
        markCancelled: (transferId) => {
          calls.push(`storage:${transferId}`);
          return Promise.resolve();
        },
        markCompleted: () => Promise.resolve(),
      },
    });

    await service.cancel("transfer-2");
    expect(calls).toEqual(["native:transfer-2", "storage:transfer-2"]);
  });
});
