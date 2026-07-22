export type NativeClientErrorCode =
  | "CLIENT_CLOSED"
  | "CLIENT_STOPPED"
  | "DISCONNECTED"
  | "HOST_UNAVAILABLE"
  | "POST_FAILED"
  | "PROTOCOL_ERROR"
  | "REQUEST_TIMEOUT";

export class NativeClientError extends Error {
  constructor(
    readonly code: NativeClientErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NativeClientError";
  }
}

export class NativeHostError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeHostError";
  }
}

export function isNativeHostUnavailable(error: unknown): boolean {
  return (
    error instanceof NativeClientError &&
    (error.code === "DISCONNECTED" ||
      error.code === "HOST_UNAVAILABLE" ||
      error.code === "POST_FAILED")
  );
}
