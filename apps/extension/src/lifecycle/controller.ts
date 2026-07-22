import type { StoredTransfer } from "../storage/transfers";

export type ServerState = "stopped" | "running";

export interface BookBridgeRuntimeState {
  enabled: boolean;
  serverState: ServerState;
  activeTransferCount: number;
}

export interface LifecycleNativeClient {
  stop(): void;
  dispose(): void;
}

export interface LifecycleTransferRepository {
  list(): Promise<readonly StoredTransfer[]>;
  cancelActive(): Promise<number>;
}

export interface LifecycleSettings {
  getEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
}

export interface LifecycleControllerOptions {
  nativeClient: LifecycleNativeClient;
  transfers: LifecycleTransferRepository;
  settings: LifecycleSettings;
  now?: () => number;
  onError?: (error: unknown) => void;
}

// Keeps the Native Host disconnected at rest. A qualifying download opens the
// connection, while terminal or expired transfers release it again.
export class LifecycleController {
  readonly #nativeClient: LifecycleNativeClient;
  readonly #transfers: LifecycleTransferRepository;
  readonly #settings: LifecycleSettings;
  readonly #now: () => number;
  readonly #onError: (error: unknown) => void;
  readonly #initialization: Promise<void>;

  #enabled = true;
  #running = false;
  #attempts = 0;
  #expirationTimer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;

  constructor(options: LifecycleControllerOptions) {
    this.#nativeClient = options.nativeClient;
    this.#transfers = options.transfers;
    this.#settings = options.settings;
    this.#now = options.now ?? Date.now;
    this.#onError = options.onError ?? (() => undefined);
    this.#initialization = this.#initialize();
  }

  async beginTransferAttempt(): Promise<boolean> {
    await this.#initialization;
    if (this.#disposed || !this.#enabled) {
      return false;
    }
    this.#attempts += 1;
    this.#running = true;
    return true;
  }

  async transferCreated(): Promise<void> {
    await this.#finishAttempt();
  }

  async transferFailed(): Promise<void> {
    await this.#finishAttempt();
  }

  async transferSettled(): Promise<void> {
    await this.#initialization;
    await this.#reconcile();
  }

  async setEnabled(enabled: boolean): Promise<BookBridgeRuntimeState> {
    await this.#initialization;
    if (this.#disposed) {
      return this.#stoppedState();
    }
    await this.#settings.setEnabled(enabled);
    this.#enabled = enabled;
    if (!enabled) {
      await this.#transfers.cancelActive();
    }
    return this.#reconcile();
  }

  async getState(): Promise<BookBridgeRuntimeState> {
    await this.#initialization;
    return this.#reconcile();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#clearExpirationTimer();
    this.#running = false;
    this.#nativeClient.dispose();
  }

  async #initialize(): Promise<void> {
    this.#enabled = await this.#settings.getEnabled();
    if (this.#disposed) {
      return;
    }
    // A prior background instance closing also terminated its in-memory host,
    // so session records cannot be resumed safely after a worker restart.
    await this.#transfers.cancelActive();
    this.#nativeClient.stop();
  }

  async #finishAttempt(): Promise<void> {
    await this.#initialization;
    this.#attempts = Math.max(0, this.#attempts - 1);
    // Pausing can race with a CREATE_TRANSFER response. If that response was
    // already accepted, cancel the record it just wrote before disconnecting.
    if (!this.#enabled) {
      await this.#transfers.cancelActive();
    }
    await this.#reconcile();
  }

  async #reconcile(): Promise<BookBridgeRuntimeState> {
    const now = this.#now();
    const transfers = await this.#transfers.list();
    const activeTransfers = transfers.filter(
      (transfer) => transfer.status === "active" && transfer.expiresAt > now,
    );
    this.#clearExpirationTimer();

    const shouldRun =
      !this.#disposed &&
      this.#enabled &&
      this.#running &&
      (this.#attempts > 0 || activeTransfers.length > 0);
    if (!shouldRun) {
      const wasRunning = this.#running;
      this.#running = false;
      if (wasRunning) {
        this.#nativeClient.stop();
      }
    } else if (activeTransfers.length > 0) {
      const nextExpiration = Math.min(
        ...activeTransfers.map((transfer) => transfer.expiresAt),
      );
      this.#expirationTimer = setTimeout(
        () => {
          this.#expirationTimer = undefined;
          void this.#reconcile().catch(this.#onError);
        },
        Math.max(0, nextExpiration - now),
      );
    }

    return {
      enabled: this.#enabled,
      serverState: shouldRun ? "running" : "stopped",
      activeTransferCount: activeTransfers.length,
    };
  }

  #clearExpirationTimer(): void {
    if (this.#expirationTimer !== undefined) {
      clearTimeout(this.#expirationTimer);
      this.#expirationTimer = undefined;
    }
  }

  #stoppedState(): BookBridgeRuntimeState {
    return {
      enabled: this.#enabled,
      serverState: "stopped",
      activeTransferCount: 0,
    };
  }
}
