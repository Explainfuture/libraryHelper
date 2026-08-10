export const CHUNK_SIZE = 48 * 1024;
export const MAX_IN_FLIGHT_CHUNKS = 8;
export const MAX_EPUB_BYTES = 256 * 1024 * 1024;
export const SESSION_LIFETIME_MS = 10 * 60 * 1000;

export interface HelloMessage {
  type: "hello";
  token: string;
}

export interface ReadyMessage {
  type: "ready";
}

export interface AckMessage {
  type: "ack";
  nextChunk: number;
}

export interface ReceivedMessage {
  type: "received";
  size: number;
}

export interface ReceiverErrorMessage {
  type: "error";
  message: string;
}

export type ReceiverMessage =
  | AckMessage
  | HelloMessage
  | ReadyMessage
  | ReceivedMessage
  | ReceiverErrorMessage;

export interface MetadataMessage {
  type: "metadata";
  filename: string;
  mime: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
}

export interface ChunkMessage {
  type: "chunk";
  index: number;
  data: ArrayBuffer;
}

export interface FinishMessage {
  type: "finish";
}

export interface CancelMessage {
  type: "cancel";
}

export type SenderMessage =
  CancelMessage | ChunkMessage | FinishMessage | MetadataMessage;

export function parseReceiverMessage(value: unknown): ReceiverMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  switch (value.type) {
    case "hello":
      return hasExactKeys(value, ["type", "token"]) &&
        isNonEmptyString(value.token)
        ? { type: "hello", token: value.token }
        : null;
    case "ready":
      return hasExactKeys(value, ["type"]) ? { type: "ready" } : null;
    case "ack":
      return hasExactKeys(value, ["type", "nextChunk"]) &&
        isNonNegativeSafeInteger(value.nextChunk)
        ? { type: "ack", nextChunk: value.nextChunk }
        : null;
    case "received":
      return hasExactKeys(value, ["type", "size"]) &&
        isNonNegativeSafeInteger(value.size)
        ? { type: "received", size: value.size }
        : null;
    case "error":
      return hasExactKeys(value, ["type", "message"]) &&
        isNonEmptyString(value.message)
        ? { type: "error", message: value.message }
        : null;
    default:
      return null;
  }
}

export function parseSenderMessage(value: unknown): SenderMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }
  switch (value.type) {
    case "metadata":
      if (
        !hasExactKeys(value, [
          "type",
          "filename",
          "mime",
          "size",
          "chunkSize",
          "totalChunks",
        ]) ||
        !isNonEmptyString(value.filename) ||
        typeof value.mime !== "string" ||
        !isNonNegativeSafeInteger(value.size) ||
        !isPositiveSafeInteger(value.chunkSize) ||
        !isNonNegativeSafeInteger(value.totalChunks)
      ) {
        return null;
      }
      return {
        type: "metadata",
        filename: value.filename,
        mime: value.mime,
        size: value.size,
        chunkSize: value.chunkSize,
        totalChunks: value.totalChunks,
      };
    case "chunk": {
      if (
        !hasExactKeys(value, ["type", "index", "data"]) ||
        !isNonNegativeSafeInteger(value.index)
      ) {
        return null;
      }
      const data = toArrayBuffer(value.data);
      return data === null ? null : { type: "chunk", index: value.index, data };
    }
    case "finish":
      return hasExactKeys(value, ["type"]) ? { type: "finish" } : null;
    case "cancel":
      return hasExactKeys(value, ["type"]) ? { type: "cancel" } : null;
    default:
      return null;
  }
}

function toArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(
      value.byteOffset,
      value.byteOffset + value.byteLength,
    ) as ArrayBuffer;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length && expected.every((key) => key in value)
  );
}
