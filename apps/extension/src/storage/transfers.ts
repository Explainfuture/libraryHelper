import {
  isLocalHTTPURL,
  type TransferCreatedMessage,
} from "../protocol/messages";
import type { SessionStorageArea } from "./pending-downloads";

export const TRANSFERS_KEY = "bookbridge.transfers";
const DEFAULT_CAPACITY = 16;

export type TransferStatus = "active" | "cancelled" | "completed";

export type StoredTransfer = TransferCreatedMessage["payload"] & {
  status: TransferStatus;
};

// Keeps only public transfer metadata. In particular, local file paths are
// never written to the transfer record consumed by extension pages.
export class TransferStore {
  readonly #storage: SessionStorageArea;
  readonly #capacity: number;
  #tail: Promise<void> = Promise.resolve();

  constructor(storage: SessionStorageArea, capacity = DEFAULT_CAPACITY) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError("capacity must be a positive safe integer");
    }
    this.#storage = storage;
    this.#capacity = capacity;
  }

  save(payload: TransferCreatedMessage["payload"]): Promise<void> {
    return this.#enqueue(async () => {
      const transfers = await this.#load();
      const remaining = transfers.filter(
        (transfer) => transfer.transferId !== payload.transferId,
      );
      remaining.push({ ...payload, status: "active" });
      await this.#write(remaining.slice(-this.#capacity));
    });
  }

  markCompleted(transferId: string): Promise<void> {
    return this.#markStatus(transferId, "completed");
  }

  markCancelled(transferId: string): Promise<void> {
    return this.#markStatus(transferId, "cancelled");
  }

  async get(transferId: string): Promise<StoredTransfer | undefined> {
    await this.#tail;
    const transfers = await this.#load();
    return transfers.find((transfer) => transfer.transferId === transferId);
  }

  async list(): Promise<readonly StoredTransfer[]> {
    await this.#tail;
    return this.#load();
  }

  #markStatus(transferId: string, status: TransferStatus): Promise<void> {
    return this.#enqueue(async () => {
      const transfers = await this.#load();
      const transfer = transfers.find(
        (candidate) => candidate.transferId === transferId,
      );
      if (transfer === undefined || transfer.status === status) {
        return;
      }
      transfer.status = status;
      await this.#write(transfers);
    });
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.#tail.then(operation);
    this.#tail = result.catch(() => undefined);
    return result;
  }

  async #load(): Promise<StoredTransfer[]> {
    const values = await this.#storage.get(TRANSFERS_KEY);
    return parseStoredTransfers(values[TRANSFERS_KEY]);
  }

  #write(transfers: readonly StoredTransfer[]): Promise<void> {
    return this.#storage.set({ [TRANSFERS_KEY]: transfers });
  }
}

function parseStoredTransfers(value: unknown): StoredTransfer[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const transfers: StoredTransfer[] = [];
  for (const candidate of value as unknown[]) {
    if (isStoredTransfer(candidate)) {
      transfers.push(candidate);
    }
  }
  return transfers;
}

function isStoredTransfer(value: unknown): value is StoredTransfer {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return (
    "transferId" in value &&
    typeof value.transferId === "string" &&
    value.transferId !== "" &&
    "url" in value &&
    isLocalHTTPURL(value.url) &&
    "filename" in value &&
    typeof value.filename === "string" &&
    value.filename !== "" &&
    "size" in value &&
    isNonNegativeSafeInteger(value.size) &&
    "expiresAt" in value &&
    isNonNegativeSafeInteger(value.expiresAt) &&
    "status" in value &&
    isTransferStatus(value.status)
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTransferStatus(value: unknown): value is TransferStatus {
  return value === "active" || value === "cancelled" || value === "completed";
}
