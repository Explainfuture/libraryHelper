export interface CancelTransferCommand {
  type: "CANCEL_TRANSFER";
  transferId: string;
}

export interface RuntimeSuccessResponse {
  ok: true;
}

export interface RuntimeErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type RuntimeResponse = RuntimeSuccessResponse | RuntimeErrorResponse;

export function parseCancelTransferCommand(
  value: unknown,
): CancelTransferCommand | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("type" in value) ||
    value.type !== "CANCEL_TRANSFER" ||
    !("transferId" in value) ||
    typeof value.transferId !== "string" ||
    value.transferId === ""
  ) {
    return null;
  }
  return { type: "CANCEL_TRANSFER", transferId: value.transferId };
}

export function parseRuntimeResponse(value: unknown): RuntimeResponse | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("ok" in value) ||
    typeof value.ok !== "boolean"
  ) {
    return null;
  }
  if (value.ok) {
    return Object.keys(value).length === 1 ? { ok: true } : null;
  }
  if (
    Object.keys(value).length !== 2 ||
    !("error" in value) ||
    typeof value.error !== "object" ||
    value.error === null ||
    Array.isArray(value.error) ||
    Object.keys(value.error).length !== 2 ||
    !("code" in value.error) ||
    typeof value.error.code !== "string" ||
    value.error.code === "" ||
    !("message" in value.error) ||
    typeof value.error.message !== "string"
  ) {
    return null;
  }
  return {
    ok: false,
    error: { code: value.error.code, message: value.error.message },
  };
}
