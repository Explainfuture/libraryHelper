import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoredTransfer } from "../storage/transfers";
import { LifecycleController } from "./controller";

class MemoryTransfers {
  readonly records: StoredTransfer[] = [];

  async list(): Promise<readonly StoredTransfer[]> {
    await Promise.resolve();
    return this.records;
  }

  async cancelActive(): Promise<number> {
    await Promise.resolve();
    let cancelled = 0;
    for (const record of this.records) {
      if (record.status === "active") {
        record.status = "cancelled";
        cancelled += 1;
      }
    }
    return cancelled;
  }
}

class MemorySettings {
  enabled = true;

  async getEnabled(): Promise<boolean> {
    await Promise.resolve();
    return this.enabled;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await Promise.resolve();
    this.enabled = enabled;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("LifecycleController", () => {
  it("keeps the Native Host stopped while the extension is idle", async () => {
    const nativeClient = { stop: vi.fn(), dispose: vi.fn() };
    const controller = new LifecycleController({
      nativeClient,
      transfers: new MemoryTransfers(),
      settings: new MemorySettings(),
    });

    await expect(controller.getState()).resolves.toEqual({
      enabled: true,
      serverState: "stopped",
      activeTransferCount: 0,
    });
    expect(nativeClient.stop).toHaveBeenCalled();
    controller.dispose();
  });

  it("runs on demand and stops at the earliest transfer expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T00:00:00Z"));
    const nativeClient = { stop: vi.fn(), dispose: vi.fn() };
    const transfers = new MemoryTransfers();
    const controller = new LifecycleController({
      nativeClient,
      transfers,
      settings: new MemorySettings(),
    });

    await expect(controller.beginTransferAttempt()).resolves.toBe(true);
    transfers.records.push(activeTransfer(Date.now() + 1_000));
    await controller.transferCreated();
    await expect(controller.getState()).resolves.toMatchObject({
      serverState: "running",
      activeTransferCount: 1,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(controller.getState()).resolves.toMatchObject({
      serverState: "stopped",
      activeTransferCount: 0,
    });
    expect(nativeClient.stop).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it("stops immediately after the final transfer settles", async () => {
    const nativeClient = { stop: vi.fn(), dispose: vi.fn() };
    const transfers = new MemoryTransfers();
    const controller = new LifecycleController({
      nativeClient,
      transfers,
      settings: new MemorySettings(),
    });
    await controller.beginTransferAttempt();
    transfers.records.push(activeTransfer(Date.now() + 60_000));
    await controller.transferCreated();

    const record = transfers.records[0];
    if (record === undefined) {
      throw new Error("active transfer is missing");
    }
    record.status = "completed";
    await controller.transferSettled();

    await expect(controller.getState()).resolves.toMatchObject({
      serverState: "stopped",
      activeTransferCount: 0,
    });
    controller.dispose();
  });

  it("pauses immediately and resumes without starting the host", async () => {
    const nativeClient = { stop: vi.fn(), dispose: vi.fn() };
    const transfers = new MemoryTransfers();
    const settings = new MemorySettings();
    const controller = new LifecycleController({
      nativeClient,
      transfers,
      settings,
    });
    await controller.beginTransferAttempt();
    transfers.records.push(activeTransfer(Date.now() + 60_000));
    await controller.transferCreated();

    await expect(controller.setEnabled(false)).resolves.toEqual({
      enabled: false,
      serverState: "stopped",
      activeTransferCount: 0,
    });
    expect(transfers.records[0]?.status).toBe("cancelled");
    await expect(controller.beginTransferAttempt()).resolves.toBe(false);
    await expect(controller.setEnabled(true)).resolves.toEqual({
      enabled: true,
      serverState: "stopped",
      activeTransferCount: 0,
    });
    expect(settings.enabled).toBe(true);
    controller.dispose();
  });

  it("cancels a transfer created concurrently with pausing", async () => {
    const nativeClient = { stop: vi.fn(), dispose: vi.fn() };
    const transfers = new MemoryTransfers();
    const settings = new MemorySettings();
    const controller = new LifecycleController({
      nativeClient,
      transfers,
      settings,
    });

    await controller.beginTransferAttempt();
    await controller.setEnabled(false);
    transfers.records.push(activeTransfer(Date.now() + 60_000));
    await controller.transferCreated();

    expect(transfers.records[0]?.status).toBe("cancelled");
    await expect(controller.getState()).resolves.toEqual({
      enabled: false,
      serverState: "stopped",
      activeTransferCount: 0,
    });
    controller.dispose();
  });
});

function activeTransfer(expiresAt: number): StoredTransfer {
  return {
    transferId: crypto.randomUUID(),
    url: "http://192.168.1.10:18321/t/token",
    filename: "book.epub",
    size: 123,
    expiresAt,
    status: "active",
  };
}
