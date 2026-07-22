import { describe, expect, it } from "vitest";

import {
  SETTINGS_KEY,
  SettingsStore,
  type SettingsStorageArea,
} from "./settings";

class MemoryStorage implements SettingsStorageArea {
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

describe("SettingsStore", () => {
  it("defaults to enabled without writing storage", async () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage);

    await expect(store.getEnabled()).resolves.toBe(true);
    expect(storage.values).toEqual({});
  });

  it("persists and restores the pause preference", async () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage);

    await store.setEnabled(false);
    await expect(store.getEnabled()).resolves.toBe(false);
    expect(storage.values[SETTINGS_KEY]).toEqual({
      version: 1,
      enabled: false,
    });
  });

  it("ignores malformed or future settings", async () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage);
    storage.values[SETTINGS_KEY] = { version: 2, enabled: false };

    await expect(store.getEnabled()).resolves.toBe(true);
  });
});
