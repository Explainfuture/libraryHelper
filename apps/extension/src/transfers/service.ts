import type { EligibleDownload } from "../downloads/coordinator";
import type {
  TransferCancelledMessage,
  TransferCompletedMessage,
  TransferCreatedMessage,
} from "../protocol/messages";
import type { PendingDownload } from "../storage/pending-downloads";

export interface TransferNativeClient {
  createTransfer(
    filePath: string,
    downloadId: number,
  ): Promise<TransferCreatedMessage>;
  cancelTransfer(transferId: string): Promise<TransferCancelledMessage>;
}

export interface TransferPendingQueue {
  enqueue(download: PendingDownload): Promise<void>;
  remove(downloadId: number): Promise<void>;
}

export interface TransferRepository {
  save(payload: TransferCreatedMessage["payload"]): Promise<void>;
  markCancelled(transferId: string): Promise<void>;
  markCompleted(transferId: string): Promise<void>;
}

export interface TransferServiceOptions {
  nativeClient: TransferNativeClient;
  pendingDownloads: TransferPendingQueue;
  transfers: TransferRepository;
  now?: () => number;
}

// Coordinates the durable extension-side handoff without ever storing a local
// path in the public transfer metadata used by extension pages.
export class TransferService {
  readonly #nativeClient: TransferNativeClient;
  readonly #pendingDownloads: TransferPendingQueue;
  readonly #transfers: TransferRepository;
  readonly #now: () => number;

  constructor(options: TransferServiceOptions) {
    this.#nativeClient = options.nativeClient;
    this.#pendingDownloads = options.pendingDownloads;
    this.#transfers = options.transfers;
    this.#now = options.now ?? Date.now;
  }

  async create(download: EligibleDownload): Promise<TransferCreatedMessage> {
    await this.#pendingDownloads.enqueue({
      ...download,
      detectedAt: this.#now(),
    });
    try {
      const response = await this.#nativeClient.createTransfer(
        download.filePath,
        download.downloadId,
      );
      await this.#transfers.save(response.payload);
      await this.#pendingDownloads.remove(download.downloadId);
      return response;
    } catch (error: unknown) {
      try {
        await this.#pendingDownloads.remove(download.downloadId);
      } catch {
        // Preserve the more useful native/storage error from the transfer path.
      }
      throw error;
    }
  }

  complete(message: TransferCompletedMessage): Promise<void> {
    return this.#transfers.markCompleted(message.payload.transferId);
  }

  async cancel(transferId: string): Promise<void> {
    const response = await this.#nativeClient.cancelTransfer(transferId);
    await this.#transfers.markCancelled(response.payload.transferId);
  }
}
