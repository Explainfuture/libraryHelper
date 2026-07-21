import {
  cancelTransferRequest,
  createTransferRequest,
  parseNativeMessage,
  type NativeRequest,
  type TransferCancelledMessage,
  type TransferCompletedMessage,
  type TransferCreatedMessage,
} from "../protocol/messages";
import { NativeClientError, NativeHostError } from "./errors";

export interface NativePortEvent<
  Listener extends (...arguments_: never[]) => void,
> {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
}

export interface NativePort {
  readonly onMessage: NativePortEvent<(message: unknown) => void>;
  readonly onDisconnect: NativePortEvent<() => void>;
  postMessage(message: NativeRequest): void;
  disconnect(): void;
}

export interface NativeClientOptions {
  connect: () => NativePort;
  getLastError?: () => string | undefined;
  requestTimeoutMs?: number;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

type ExpectedResponseType = "TRANSFER_CREATED" | "TRANSFER_CANCELLED";
type SolicitedMessage = TransferCreatedMessage | TransferCancelledMessage;
type CompletionListener = (message: TransferCompletedMessage) => void;

interface PendingRequest {
  expectedType: ExpectedResponseType;
  resolve: (message: SolicitedMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface AttachedPort {
  port: NativePort;
  onMessage: (message: unknown) => void;
  onDisconnect: () => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_INITIAL_RECONNECT_DELAY_MS = 500;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000;

// Owns one persistent Native Messaging port. Requests are correlated by ID,
// while disconnects reject in-flight work and trigger bounded exponential
// reconnect attempts.
export class NativeClient {
  readonly #connect: NativeClientOptions["connect"];
  readonly #getLastError: NonNullable<NativeClientOptions["getLastError"]>;
  readonly #requestTimeoutMs: number;
  readonly #initialReconnectDelayMs: number;
  readonly #maxReconnectDelayMs: number;
  readonly #pending = new Map<string, PendingRequest>();
  readonly #completionListeners = new Set<CompletionListener>();

  #attached: AttachedPort | undefined;
  #reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
  #nextReconnectDelayMs: number;
  #lastConnectionError: NativeClientError | undefined;
  #active = false;
  #closed = false;

  constructor(options: NativeClientOptions) {
    this.#connect = options.connect;
    this.#getLastError = options.getLastError ?? (() => undefined);
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
    this.#initialReconnectDelayMs = positiveInteger(
      options.initialReconnectDelayMs ?? DEFAULT_INITIAL_RECONNECT_DELAY_MS,
      "initialReconnectDelayMs",
    );
    this.#maxReconnectDelayMs = positiveInteger(
      options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS,
      "maxReconnectDelayMs",
    );
    if (this.#maxReconnectDelayMs < this.#initialReconnectDelayMs) {
      throw new RangeError(
        "maxReconnectDelayMs must be greater than or equal to initialReconnectDelayMs",
      );
    }
    this.#nextReconnectDelayMs = this.#initialReconnectDelayMs;
  }

  start(): void {
    this.#assertOpen();
    this.#active = true;
    this.#connectIfNeeded();
  }

  async createTransfer(
    filePath: string,
    downloadId: number,
  ): Promise<TransferCreatedMessage> {
    const response = await this.#request(
      createTransferRequest(filePath, downloadId),
      "TRANSFER_CREATED",
    );
    if (response.type !== "TRANSFER_CREATED") {
      throw new NativeClientError(
        "PROTOCOL_ERROR",
        "native host returned the wrong response type",
      );
    }
    return response;
  }

  async cancelTransfer(transferId: string): Promise<TransferCancelledMessage> {
    const response = await this.#request(
      cancelTransferRequest(transferId),
      "TRANSFER_CANCELLED",
    );
    if (response.type !== "TRANSFER_CANCELLED") {
      throw new NativeClientError(
        "PROTOCOL_ERROR",
        "native host returned the wrong response type",
      );
    }
    return response;
  }

  onTransferCompleted(listener: CompletionListener): () => void {
    this.#completionListeners.add(listener);
    return () => this.#completionListeners.delete(listener);
  }

  dispose(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#active = false;
    if (this.#reconnectTimeout !== undefined) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = undefined;
    }
    const attached = this.#attached;
    if (attached !== undefined) {
      this.#detach(attached);
      this.#attached = undefined;
      try {
        attached.port.disconnect();
      } catch {
        // The browser may already have closed the native port.
      }
    }
    this.#rejectPending(
      new NativeClientError("CLIENT_CLOSED", "native client is closed"),
    );
    this.#completionListeners.clear();
  }

  #request(
    request: NativeRequest,
    expectedType: ExpectedResponseType,
  ): Promise<SolicitedMessage> {
    try {
      this.#assertOpen();
    } catch (error: unknown) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new NativeClientError("CLIENT_CLOSED", "native client is closed"),
      );
    }
    this.#active = true;
    const port = this.#connectIfNeeded();
    if (port === undefined) {
      return Promise.reject(
        this.#lastConnectionError ??
          new NativeClientError(
            "HOST_UNAVAILABLE",
            "native host is unavailable",
          ),
      );
    }

    return new Promise<SolicitedMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(request.requestId);
        reject(
          new NativeClientError(
            "REQUEST_TIMEOUT",
            "native host request timed out",
          ),
        );
      }, this.#requestTimeoutMs);
      this.#pending.set(request.requestId, {
        expectedType,
        resolve,
        reject,
        timeout,
      });

      try {
        port.postMessage(request);
      } catch (error: unknown) {
        this.#failPort(
          port,
          new NativeClientError(
            "POST_FAILED",
            "failed to send a message to the native host",
            { cause: error },
          ),
        );
      }
    });
  }

  #connectIfNeeded(): NativePort | undefined {
    if (this.#closed || !this.#active) {
      return undefined;
    }
    if (this.#attached !== undefined) {
      return this.#attached.port;
    }
    if (this.#reconnectTimeout !== undefined) {
      clearTimeout(this.#reconnectTimeout);
      this.#reconnectTimeout = undefined;
    }

    try {
      const port = this.#connect();
      const attached: AttachedPort = {
        port,
        onMessage: (message) => {
          this.#handleMessage(port, message);
        },
        onDisconnect: () => {
          this.#handleDisconnect(port);
        },
      };
      port.onMessage.addListener(attached.onMessage);
      port.onDisconnect.addListener(attached.onDisconnect);
      this.#attached = attached;
      this.#lastConnectionError = undefined;
      return port;
    } catch (error: unknown) {
      this.#lastConnectionError = new NativeClientError(
        "HOST_UNAVAILABLE",
        "failed to start the native host",
        { cause: error },
      );
      this.#scheduleReconnect();
      return undefined;
    }
  }

  #handleMessage(port: NativePort, rawMessage: unknown): void {
    if (this.#attached?.port !== port) {
      return;
    }
    const message = parseNativeMessage(rawMessage);
    if (message === null) {
      return;
    }
    this.#nextReconnectDelayMs = this.#initialReconnectDelayMs;

    if (message.type === "TRANSFER_COMPLETED") {
      for (const listener of this.#completionListeners) {
        listener(message);
      }
      return;
    }

    const pending = this.#pending.get(message.requestId);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(message.requestId);
    clearTimeout(pending.timeout);

    if (message.type === "ERROR") {
      pending.reject(
        new NativeHostError(message.error.code, message.error.message),
      );
      return;
    }
    if (message.type !== pending.expectedType) {
      pending.reject(
        new NativeClientError(
          "PROTOCOL_ERROR",
          `expected ${pending.expectedType}, received ${message.type}`,
        ),
      );
      return;
    }
    pending.resolve(message);
  }

  #handleDisconnect(port: NativePort): void {
    if (this.#attached?.port !== port) {
      return;
    }
    const browserError = this.#getLastError();
    const error = new NativeClientError(
      browserError === undefined ? "DISCONNECTED" : "HOST_UNAVAILABLE",
      browserError ?? "native host disconnected",
    );
    this.#failPort(port, error);
  }

  #failPort(port: NativePort, error: NativeClientError): void {
    const attached = this.#attached;
    if (attached?.port !== port) {
      return;
    }
    this.#detach(attached);
    this.#attached = undefined;
    this.#lastConnectionError = error;
    this.#rejectPending(error);
    try {
      port.disconnect();
    } catch {
      // The browser may already have closed the native port.
    }
    this.#scheduleReconnect();
  }

  #detach(attached: AttachedPort): void {
    attached.port.onMessage.removeListener(attached.onMessage);
    attached.port.onDisconnect.removeListener(attached.onDisconnect);
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #scheduleReconnect(): void {
    if (this.#closed || !this.#active || this.#reconnectTimeout !== undefined) {
      return;
    }
    const delay = this.#nextReconnectDelayMs;
    this.#nextReconnectDelayMs = Math.min(
      this.#nextReconnectDelayMs * 2,
      this.#maxReconnectDelayMs,
    );
    this.#reconnectTimeout = setTimeout(() => {
      this.#reconnectTimeout = undefined;
      this.#connectIfNeeded();
    }, delay);
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new NativeClientError("CLIENT_CLOSED", "native client is closed");
    }
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}
