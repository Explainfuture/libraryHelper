import { BoundedDownloadSet } from "./bounded-download-set";
import { isEligibleEpub } from "./eligibility";

export interface DownloadDelta {
  id: number;
  state?: string | undefined;
}

export interface DownloadItem {
  id: number;
  filename: string;
  fileSize?: number;
  mime?: string;
}

export interface EligibleDownload {
  downloadId: number;
  filename: string;
  fileSize?: number;
}

export interface DownloadCoordinatorOptions {
  search: (downloadId: number) => Promise<readonly DownloadItem[]>;
  onEligible: (download: EligibleDownload) => Promise<void>;
  capacity?: number;
}

export class DownloadCoordinator {
  readonly #handled: BoundedDownloadSet;
  readonly #search: DownloadCoordinatorOptions["search"];
  readonly #onEligible: DownloadCoordinatorOptions["onEligible"];

  constructor(options: DownloadCoordinatorOptions) {
    this.#handled = new BoundedDownloadSet(options.capacity);
    this.#search = options.search;
    this.#onEligible = options.onEligible;
  }

  async handle(delta: DownloadDelta): Promise<boolean> {
    if (delta.state !== "complete" || !this.#handled.claim(delta.id)) {
      return false;
    }

    try {
      const items = await this.#search(delta.id);
      const item = items.find((candidate) => candidate.id === delta.id);
      if (item === undefined || !isEligibleEpub(item)) {
        return false;
      }
      await this.#onEligible({
        downloadId: item.id,
        filename: item.filename,
        ...(item.fileSize === undefined ? {} : { fileSize: item.fileSize }),
      });
      return true;
    } catch (error: unknown) {
      this.#handled.release(delta.id);
      throw error;
    }
  }
}
