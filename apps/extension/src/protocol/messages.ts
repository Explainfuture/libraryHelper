export const NATIVE_HOST_NAME = "com.bookbridge.host";

export interface CreateTransferRequest {
  type: "CREATE_TRANSFER";
  requestId: string;
  payload: {
    filePath: string;
    downloadId: number;
  };
}

export interface CancelTransferRequest {
  type: "CANCEL_TRANSFER";
  requestId: string;
  payload: {
    transferId: string;
  };
}

export type NativeRequest = CreateTransferRequest | CancelTransferRequest;

export interface TransferCreatedMessage {
  type: "TRANSFER_CREATED";
  requestId: string;
  payload: {
    transferId: string;
    url: string;
    filename: string;
    size: number;
    expiresAt: number;
  };
}

export interface TransferCancelledMessage {
  type: "TRANSFER_CANCELLED";
  requestId: string;
  payload: {
    transferId: string;
  };
}

export interface TransferCompletedMessage {
  type: "TRANSFER_COMPLETED";
  requestId: string;
  payload: {
    transferId: string;
  };
}

export interface NativeErrorMessage {
  type: "ERROR";
  requestId: string;
  error: {
    code: string;
    message: string;
  };
}

export type NativeMessage =
  | TransferCreatedMessage
  | TransferCancelledMessage
  | TransferCompletedMessage
  | NativeErrorMessage;

const ENVELOPE_KEYS = {
  response: ["type", "requestId", "payload"],
  error: ["type", "requestId", "error"],
} as const;
const CREATED_PAYLOAD_KEYS = [
  "transferId",
  "url",
  "filename",
  "size",
  "expiresAt",
] as const;
const TRANSFER_ID_KEYS = ["transferId"] as const;
const ERROR_KEYS = ["code", "message"] as const;

export function createTransferRequest(
  filePath: string,
  downloadId: number,
  requestId: string = crypto.randomUUID(),
): CreateTransferRequest {
  return {
    type: "CREATE_TRANSFER",
    requestId,
    payload: { filePath, downloadId },
  };
}

export function cancelTransferRequest(
  transferId: string,
  requestId: string = crypto.randomUUID(),
): CancelTransferRequest {
  return {
    type: "CANCEL_TRANSFER",
    requestId,
    payload: { transferId },
  };
}

export function parseNativeMessage(value: unknown): NativeMessage | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.type) ||
    !isString(value.requestId)
  ) {
    return null;
  }

  switch (value.type) {
    case "TRANSFER_CREATED":
      return parseTransferCreated(value);
    case "TRANSFER_CANCELLED":
      return parseTransferIdMessage(value, "TRANSFER_CANCELLED");
    case "TRANSFER_COMPLETED":
      return parseTransferIdMessage(value, "TRANSFER_COMPLETED");
    case "ERROR":
      return parseErrorMessage(value);
    default:
      return null;
  }
}

function parseTransferCreated(
  value: Record<string, unknown>,
): TransferCreatedMessage | null {
  if (
    !hasExactKeys(value, ENVELOPE_KEYS.response) ||
    !isRecord(value.payload)
  ) {
    return null;
  }
  const payload = value.payload;
  if (
    !hasExactKeys(payload, CREATED_PAYLOAD_KEYS) ||
    !isNonEmptyString(payload.transferId) ||
    !isLocalHTTPURL(payload.url) ||
    !isNonEmptyString(payload.filename) ||
    !isNonNegativeSafeInteger(payload.size) ||
    !isNonNegativeSafeInteger(payload.expiresAt)
  ) {
    return null;
  }
  return {
    type: "TRANSFER_CREATED",
    requestId: value.requestId as string,
    payload: {
      transferId: payload.transferId,
      url: payload.url,
      filename: payload.filename,
      size: payload.size,
      expiresAt: payload.expiresAt,
    },
  };
}

function parseTransferIdMessage(
  value: Record<string, unknown>,
  type: "TRANSFER_CANCELLED" | "TRANSFER_COMPLETED",
): TransferCancelledMessage | TransferCompletedMessage | null {
  if (
    !hasExactKeys(value, ENVELOPE_KEYS.response) ||
    !isRecord(value.payload) ||
    !hasExactKeys(value.payload, TRANSFER_ID_KEYS) ||
    !isNonEmptyString(value.payload.transferId)
  ) {
    return null;
  }
  return {
    type,
    requestId: value.requestId as string,
    payload: { transferId: value.payload.transferId },
  };
}

function parseErrorMessage(
  value: Record<string, unknown>,
): NativeErrorMessage | null {
  if (
    !hasExactKeys(value, ENVELOPE_KEYS.error) ||
    !isRecord(value.error) ||
    !hasExactKeys(value.error, ERROR_KEYS) ||
    !isNonEmptyString(value.error.code) ||
    !isString(value.error.message)
  ) {
    return null;
  }
  return {
    type: "ERROR",
    requestId: value.requestId as string,
    error: { code: value.error.code, message: value.error.message },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isLocalHTTPURL(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      isRFC1918Hostname(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function isRFC1918Hostname(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        parts[index] !== octet.toString(),
    )
  ) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 10 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
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
