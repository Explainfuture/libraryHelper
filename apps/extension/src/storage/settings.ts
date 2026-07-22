export const SETTINGS_KEY = "bookbridge.settings";
const SETTINGS_VERSION = 1;

export interface SettingsStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

interface StoredSettings {
  version: typeof SETTINGS_VERSION;
  enabled: boolean;
}

export class SettingsStore {
  readonly #storage: SettingsStorageArea;

  constructor(storage: SettingsStorageArea) {
    this.#storage = storage;
  }

  async getEnabled(): Promise<boolean> {
    const values = await this.#storage.get(SETTINGS_KEY);
    const settings = parseSettings(values[SETTINGS_KEY]);
    return settings?.enabled ?? true;
  }

  setEnabled(enabled: boolean): Promise<void> {
    const settings: StoredSettings = {
      version: SETTINGS_VERSION,
      enabled,
    };
    return this.#storage.set({ [SETTINGS_KEY]: settings });
  }
}

function parseSettings(value: unknown): StoredSettings | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("version" in value) ||
    value.version !== SETTINGS_VERSION ||
    !("enabled" in value) ||
    typeof value.enabled !== "boolean"
  ) {
    return undefined;
  }
  return { version: SETTINGS_VERSION, enabled: value.enabled };
}
