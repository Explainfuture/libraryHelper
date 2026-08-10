import {
  CHUNK_SIZE,
  MAX_IN_FLIGHT_CHUNKS,
  parseReceiverMessage,
  SESSION_LIFETIME_MS,
  type MetadataMessage,
} from "@bookbridge/protocol";
import Peer, { type DataConnection } from "peerjs";

const PEER_OPEN_TIMEOUT_MS = 15_000;

export type SenderPhase =
  | "cancelled"
  | "completed"
  | "connecting"
  | "error"
  | "expired"
  | "sending"
  | "waiting";

export interface SenderSnapshot {
  phase: SenderPhase;
  progress: number;
  shareURL?: string;
  expiresAt?: number;
  error?: string;
}

export class EpubSender {
  readonly #file: File;
  readonly #receiverPageURL: URL;
  readonly #onChange: (snapshot: SenderSnapshot) => void;
  readonly #token = randomToken(24);
  readonly #peerId = `bookbridge-${randomHex(18)}`;

  #peer: Peer | undefined;
  #connection: DataConnection | undefined;
  #expirationTimer: number | undefined;
  #phase: SenderPhase = "connecting";
  #shareURL: string | undefined;
  #expiresAt: number | undefined;
  #nextChunk = 0;
  #acknowledgedChunks = 0;
  #ready = false;
  #finishSent = false;
  #pumping = false;
  #disposed = false;

  constructor(
    file: File,
    receiverPageURL: URL,
    onChange: (snapshot: SenderSnapshot) => void,
  ) {
    this.#file = file;
    this.#receiverPageURL = receiverPageURL;
    this.#onChange = onChange;
  }

  async start(): Promise<void> {
    this.#emit();
    const peer = new Peer(this.#peerId, {
      debug: 0,
      config: {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      },
    });
    this.#peer = peer;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error("连接配对服务超时。"));
        }
      }, PEER_OPEN_TIMEOUT_MS);
      peer.once("open", () => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        resolve();
      });
      peer.once("error", () => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error("无法连接配对服务。"));
      });
    }).catch((error: unknown) => {
      this.#fail(error instanceof Error ? error.message : "无法开始传输。");
      throw error;
    });

    if (this.#disposed) {
      return;
    }
    this.#shareURL = createReceiverURL(
      this.#receiverPageURL,
      this.#peerId,
      this.#token,
    );
    this.#expiresAt = Date.now() + SESSION_LIFETIME_MS;
    this.#phase = "waiting";
    this.#expirationTimer = window.setTimeout(() => {
      this.#expire();
    }, SESSION_LIFETIME_MS);
    this.#emit();

    peer.on("connection", (connection) => {
      this.#prepareConnection(connection);
    });
    peer.on("error", (error) => {
      if (this.#isActive()) {
        this.#fail(`点对点连接失败：${error.type}`);
      }
    });
  }

  cancel(): void {
    if (this.#disposed) {
      return;
    }
    this.#phase = "cancelled";
    try {
      const connection = this.#connection;
      if (connection !== undefined) {
        void Promise.resolve(connection.send({ type: "cancel" })).catch(
          () => undefined,
        );
      }
    } catch {
      // The local cancelled state remains authoritative.
    }
    this.#emit();
    this.#disposeTransport();
  }

  dispose(): void {
    this.#disposed = true;
    this.#disposeTransport();
  }

  #prepareConnection(connection: DataConnection): void {
    if (this.#disposed || this.#connection !== undefined) {
      connection.close();
      return;
    }
    connection.on("data", (data) => {
      void this.#handleReceiverMessage(connection, data).catch(
        (error: unknown) => {
          this.#fail(
            error instanceof Error ? error.message : "发送 EPUB 时发生错误。",
          );
        },
      );
    });
    connection.on("close", () => {
      if (
        this.#connection === connection &&
        !this.#disposed &&
        (this.#phase === "sending" || this.#phase === "waiting")
      ) {
        this.#resetForAnotherReceiver();
      }
    });
    connection.on("error", () => {
      if (this.#connection === connection && !this.#disposed) {
        this.#resetForAnotherReceiver();
      }
    });
  }

  async #handleReceiverMessage(
    connection: DataConnection,
    data: unknown,
  ): Promise<void> {
    const message = parseReceiverMessage(data);
    if (message === null || this.#disposed) {
      return;
    }
    if (message.type === "hello") {
      if (message.token !== this.#token || this.#connection !== undefined) {
        connection.close();
        return;
      }
      this.#connection = connection;
      this.#phase = "sending";
      const metadata: MetadataMessage = {
        type: "metadata",
        filename: this.#file.name,
        mime: this.#file.type || "application/epub+zip",
        size: this.#file.size,
        chunkSize: CHUNK_SIZE,
        totalChunks: Math.ceil(this.#file.size / CHUNK_SIZE),
      };
      await Promise.resolve(connection.send(metadata));
      this.#emit();
      return;
    }
    if (connection !== this.#connection) {
      return;
    }
    if (message.type === "ready") {
      if (!this.#ready) {
        this.#ready = true;
        await this.#pump();
      }
      return;
    }
    if (message.type === "ack") {
      if (
        message.nextChunk < this.#acknowledgedChunks ||
        message.nextChunk > this.#nextChunk
      ) {
        throw new Error("手机返回了无效的传输进度。");
      }
      this.#acknowledgedChunks = message.nextChunk;
      this.#emit();
      await this.#pump();
      return;
    }
    if (message.type === "received") {
      if (message.size !== this.#file.size) {
        throw new Error("手机收到的文件大小不一致。");
      }
      this.#phase = "completed";
      this.#emit();
      this.#disposeTransport();
      return;
    }
    throw new Error(message.message);
  }

  async #pump(): Promise<void> {
    if (
      this.#pumping ||
      !this.#ready ||
      this.#connection === undefined ||
      this.#disposed
    ) {
      return;
    }
    this.#pumping = true;
    try {
      const connection = this.#connection;
      const totalChunks = Math.ceil(this.#file.size / CHUNK_SIZE);
      while (
        this.#nextChunk < totalChunks &&
        this.#nextChunk - this.#acknowledgedChunks < MAX_IN_FLIGHT_CHUNKS
      ) {
        const index = this.#nextChunk;
        const start = index * CHUNK_SIZE;
        const data = await this.#file
          .slice(start, Math.min(this.#file.size, start + CHUNK_SIZE))
          .arrayBuffer();
        if (!this.#isActiveConnection(connection)) {
          return;
        }
        await Promise.resolve(connection.send({ type: "chunk", index, data }));
        this.#nextChunk += 1;
      }
      if (
        !this.#finishSent &&
        this.#nextChunk === totalChunks &&
        this.#acknowledgedChunks === totalChunks
      ) {
        this.#finishSent = true;
        await Promise.resolve(connection.send({ type: "finish" }));
      }
    } finally {
      this.#pumping = false;
    }
  }

  #resetForAnotherReceiver(): void {
    this.#connection = undefined;
    this.#nextChunk = 0;
    this.#acknowledgedChunks = 0;
    this.#ready = false;
    this.#finishSent = false;
    this.#phase = "waiting";
    this.#emit();
  }

  #isActiveConnection(connection: DataConnection): boolean {
    return !this.#disposed && this.#connection === connection;
  }

  #isActive(): boolean {
    return (
      !this.#disposed &&
      (this.#phase === "connecting" ||
        this.#phase === "waiting" ||
        this.#phase === "sending")
    );
  }

  #expire(): void {
    if (this.#disposed || this.#phase === "completed") {
      return;
    }
    this.#phase = "expired";
    this.#emit();
    this.#disposeTransport();
  }

  #fail(message: string): void {
    if (this.#disposed) {
      return;
    }
    this.#phase = "error";
    this.#emit(message);
    this.#disposeTransport();
  }

  #emit(error?: string): void {
    const acknowledgedBytes = Math.min(
      this.#file.size,
      this.#acknowledgedChunks * CHUNK_SIZE,
    );
    this.#onChange({
      phase: this.#phase,
      progress:
        this.#phase === "completed" ? 1 : acknowledgedBytes / this.#file.size,
      ...(this.#shareURL === undefined ? {} : { shareURL: this.#shareURL }),
      ...(this.#expiresAt === undefined ? {} : { expiresAt: this.#expiresAt }),
      ...(error === undefined ? {} : { error }),
    });
  }

  #disposeTransport(): void {
    if (this.#expirationTimer !== undefined) {
      window.clearTimeout(this.#expirationTimer);
      this.#expirationTimer = undefined;
    }
    this.#connection?.close();
    this.#connection = undefined;
    this.#peer?.destroy();
    this.#peer = undefined;
  }
}

export function createReceiverURL(
  pageURL: URL,
  peerId: string,
  token: string,
): string {
  if (peerId === "" || token === "") {
    throw new TypeError("peerId and token are required");
  }
  const receiverURL = new URL(pageURL);
  receiverURL.search = "";
  receiverURL.hash = `/receive?${new URLSearchParams({ peer: peerId, token }).toString()}`;
  return receiverURL.toString();
}

function randomToken(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let value = "";
  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, "0");
  }
  return value;
}
