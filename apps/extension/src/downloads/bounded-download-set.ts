const DEFAULT_CAPACITY = 512;

// Tracks recently handled Chrome download IDs without allowing unbounded
// service-worker memory growth.
export class BoundedDownloadSet {
  readonly #capacity: number;
  readonly #ids = new Map<number, true>();

  constructor(capacity = DEFAULT_CAPACITY) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError("capacity must be a positive safe integer");
    }
    this.#capacity = capacity;
  }

  get size(): number {
    return this.#ids.size;
  }

  claim(downloadId: number): boolean {
    if (!Number.isSafeInteger(downloadId) || downloadId < 0) {
      throw new RangeError("downloadId must be a non-negative safe integer");
    }
    if (this.#ids.has(downloadId)) {
      this.#ids.delete(downloadId);
      this.#ids.set(downloadId, true);
      return false;
    }
    this.#ids.set(downloadId, true);
    if (this.#ids.size > this.#capacity) {
      const oldestId = this.#ids.keys().next().value;
      if (oldestId !== undefined) {
        this.#ids.delete(oldestId);
      }
    }
    return true;
  }

  release(downloadId: number): void {
    this.#ids.delete(downloadId);
  }
}
