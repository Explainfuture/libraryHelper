import type { BookBridgeRuntimeState } from "../lifecycle/controller";

export interface CancelTransferCommand {
  type: "CANCEL_TRANSFER";
  transferId: string;
}

export interface GetRuntimeStateCommand {
  type: "GET_RUNTIME_STATE";
}

export interface SetEnabledCommand {
  type: "SET_ENABLED";
  enabled: boolean;
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

export type RuntimeStateResponse =
  { ok: true; state: BookBridgeRuntimeState } | RuntimeErrorResponse;

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

export function parseGetRuntimeStateCommand(
  value: unknown,
): GetRuntimeStateCommand | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !("type" in value) ||
    value.type !== "GET_RUNTIME_STATE"
  ) {
    return null;
  }
  return { type: "GET_RUNTIME_STATE" };
}

export function parseSetEnabledCommand(
  value: unknown,
): SetEnabledCommand | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !("type" in value) ||
    value.type !== "SET_ENABLED" ||
    !("enabled" in value) ||
    typeof value.enabled !== "boolean"
  ) {
    return null;
  }
  return { type: "SET_ENABLED", enabled: value.enabled };
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

export function parseRuntimeStateResponse(
  value: unknown,
): RuntimeStateResponse | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("ok" in value) ||
    typeof value.ok !== "boolean"
  ) {
    return null;
  }
  if (!value.ok) {
    const response = parseRuntimeResponse(value);
    return response?.ok === false ? response : null;
  }
  if (
    Object.keys(value).length !== 2 ||
    !("state" in value) ||
    !isRuntimeState(value.state)
  ) {
    return null;
  }
  return { ok: true, state: value.state };
}

function isRuntimeState(value: unknown): value is BookBridgeRuntimeState {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 3 &&
    "enabled" in value &&
    typeof value.enabled === "boolean" &&
    "serverState" in value &&
    (value.serverState === "stopped" || value.serverState === "running") &&
    "activeTransferCount" in value &&
    typeof value.activeTransferCount === "number" &&
    Number.isSafeInteger(value.activeTransferCount) &&
    value.activeTransferCount >= 0
  );
}
