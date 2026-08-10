import Peer, { type DataConnection } from "peerjs";

import {
  CHUNK_SIZE,
  MAX_EPUB_BYTES,
  parseSenderMessage,
  type MetadataMessage,
} from "@bookbridge/protocol";

const CONNECTION_TIMEOUT_MS = 20_000;

export type ReceiverPhase =
  "cancelled" | "connecting" | "error" | "ready" | "receiving";

export interface ReceiverSnapshot {
  phase: ReceiverPhase;
  progress: number;
  filename?: string;
  size?: number;
  file?: File;
  error?: string;
}

export class EpubReceiver {
  readonly #senderId: string;
  readonly #token: string;
  readonly #onChange: (snapshot: ReceiverSnapshot) => void;

  #peer: Peer | undefined;
  #connection: DataConnection | undefined;
  #timeout: number | undefined;
  #metadata: MetadataMessage | undefined;
  #chunks: ArrayBuffer[] = [];
  #receivedBytes = 0;
  #phase: ReceiverPhase = "connecting";
  #disposed = false;

  constructor(
    senderId: string,
    token: string,
    onChange: (snapshot: ReceiverSnapshot) => void,
  ) {
    this.#senderId = senderId;
    this.#token = token;
    this.#onChange = onChange;
  }

  start(): void {
    this.#emit();
    const peer = new Peer({
      debug: 0,
      config: {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      },
    });
    this.#peer = peer;
    this.#timeout = window.setTimeout(() => {
      this.#fail("连接电脑超时，请确认电脑上的二维码仍然有效。");
    }, CONNECTION_TIMEOUT_MS);

    peer.on("open", () => {
      if (this.#disposed) {
        return;
      }
      const connection = peer.connect(this.#senderId, {
        reliable: true,
        serialization: "binary",
      });
      this.#connection = connection;
      connection.on("open", () => {
        this.#clearTimeout();
        void Promise.resolve(
          connection.send({ type: "hello", token: this.#token }),
        ).catch(() => {
          this.#fail("无法向电脑发送配对信息。");
        });
      });
      connection.on("data", (data) => {
        void this.#handleSenderMessage(data).catch(() => {
          this.#fail("处理 EPUB 数据时发生错误。");
        });
      });
      connection.on("close", () => {
        if (this.#isActive()) {
          this.#fail("电脑已断开连接，请重新扫描二维码。");
        }
      });
      connection.on("error", () => {
        if (this.#isActive()) {
          this.#fail("点对点连接中断，请重新扫描二维码。");
        }
      });
    });
    peer.on("error", (error) => {
      if (this.#isActive()) {
        const message =
          error.type === "peer-unavailable"
            ? "找不到电脑，请确认二维码仍然有效。"
            : `连接配对服务失败：${error.type}`;
        this.#fail(message);
      }
    });
  }

  dispose(): void {
    this.#disposed = true;
    this.#clearTimeout();
    this.#connection?.close();
    this.#connection = undefined;
    this.#peer?.destroy();
    this.#peer = undefined;
    this.#chunks = [];
  }

  async #handleSenderMessage(data: unknown): Promise<void> {
    const message = parseSenderMessage(data);
    if (message === null || this.#disposed || this.#connection === undefined) {
      return;
    }
    if (message.type === "metadata") {
      const metadataError = validateMetadata(message);
      if (metadataError !== null) {
        await Promise.resolve(
          this.#connection.send({ type: "error", message: metadataError }),
        );
        this.#fail(metadataError);
        return;
      }
      this.#metadata = {
        ...message,
        filename: sanitizeFilename(message.filename),
      };
      this.#chunks = [];
      this.#receivedBytes = 0;
      this.#phase = "receiving";
      this.#emit();
      await Promise.resolve(this.#connection.send({ type: "ready" }));
      return;
    }
    if (message.type === "chunk") {
      await this.#acceptChunk(message.index, message.data);
      return;
    }
    if (message.type === "finish") {
      await this.#finish();
      return;
    }
    this.#phase = "cancelled";
    this.#emit();
    this.#disposeTransport();
  }

  async #acceptChunk(index: number, data: ArrayBuffer): Promise<void> {
    const metadata = this.#metadata;
    const connection = this.#connection;
    if (metadata === undefined || connection === undefined) {
      return;
    }
    if (index !== this.#chunks.length || index >= metadata.totalChunks) {
      this.#fail("收到的 EPUB 分片顺序无效。");
      return;
    }
    const expectedLength = Math.min(
      metadata.chunkSize,
      metadata.size - index * metadata.chunkSize,
    );
    if (data.byteLength !== expectedLength) {
      this.#fail("收到的 EPUB 分片大小无效。");
      return;
    }
    this.#chunks.push(data);
    this.#receivedBytes += data.byteLength;
    this.#emit();
    await Promise.resolve(
      connection.send({ type: "ack", nextChunk: this.#chunks.length }),
    );
  }

  async #finish(): Promise<void> {
    const metadata = this.#metadata;
    const connection = this.#connection;
    if (
      metadata === undefined ||
      connection === undefined ||
      this.#chunks.length !== metadata.totalChunks ||
      this.#receivedBytes !== metadata.size
    ) {
      this.#fail("EPUB 尚未完整接收。");
      return;
    }
    const file = new File(this.#chunks, metadata.filename, {
      type: metadata.mime || "application/epub+zip",
      lastModified: Date.now(),
    });
    this.#phase = "ready";
    this.#emit(undefined, file);
    await Promise.resolve(
      connection.send({ type: "received", size: file.size }),
    );
    this.#disposeTransport();
  }

  #fail(message: string): void {
    if (!this.#isActive()) {
      return;
    }
    this.#phase = "error";
    try {
      const connection = this.#connection;
      if (connection !== undefined) {
        void Promise.resolve(connection.send({ type: "error", message })).catch(
          () => undefined,
        );
      }
    } catch {
      // The local error state is still useful when the peer is already gone.
    }
    this.#emit(message);
    this.#disposeTransport();
  }

  #emit(error?: string, file?: File): void {
    const metadata = this.#metadata;
    this.#onChange({
      phase: this.#phase,
      progress:
        this.#phase === "ready"
          ? 1
          : metadata === undefined || metadata.size === 0
            ? 0
            : this.#receivedBytes / metadata.size,
      ...(metadata === undefined
        ? {}
        : { filename: metadata.filename, size: metadata.size }),
      ...(file === undefined ? {} : { file }),
      ...(error === undefined ? {} : { error }),
    });
  }

  #disposeTransport(): void {
    this.#clearTimeout();
    this.#connection?.close();
    this.#connection = undefined;
    this.#peer?.destroy();
    this.#peer = undefined;
  }

  #clearTimeout(): void {
    if (this.#timeout !== undefined) {
      window.clearTimeout(this.#timeout);
      this.#timeout = undefined;
    }
  }

  #isActive(): boolean {
    return (
      !this.#disposed &&
      (this.#phase === "connecting" || this.#phase === "receiving")
    );
  }
}

function validateMetadata(metadata: MetadataMessage): string | null {
  if (metadata.size <= 0 || metadata.size > MAX_EPUB_BYTES) {
    return "EPUB 文件大小超出允许范围。";
  }
  if (
    metadata.chunkSize !== CHUNK_SIZE ||
    metadata.totalChunks !== Math.ceil(metadata.size / metadata.chunkSize)
  ) {
    return "EPUB 分片参数无效。";
  }
  return null;
}

function sanitizeFilename(filename: string): string {
  const leaf = filename.split(/[\\/]/u).at(-1) ?? "book.epub";
  let cleaned = "";
  for (const character of leaf) {
    const codePoint = character.codePointAt(0) ?? 0;
    cleaned +=
      codePoint < 32 || '<>:"|?*'.includes(character) ? "_" : character;
  }
  cleaned = cleaned.slice(0, 180);
  return cleaned.toLocaleLowerCase("en-US").endsWith(".epub")
    ? cleaned
    : `${cleaned || "book"}.epub`;
}
