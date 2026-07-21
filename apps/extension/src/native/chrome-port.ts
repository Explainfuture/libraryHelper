import { NATIVE_HOST_NAME, type NativeRequest } from "../protocol/messages";
import type { NativePort } from "./client";

export function connectBookBridgeNativePort(): NativePort {
  const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  return {
    onMessage: {
      addListener(listener) {
        port.onMessage.addListener(listener);
      },
      removeListener(listener) {
        port.onMessage.removeListener(listener);
      },
    },
    onDisconnect: {
      addListener(listener) {
        port.onDisconnect.addListener(listener);
      },
      removeListener(listener) {
        port.onDisconnect.removeListener(listener);
      },
    },
    postMessage(message: NativeRequest) {
      port.postMessage(message);
    },
    disconnect() {
      port.disconnect();
    },
  };
}

export function getChromeRuntimeLastError(): string | undefined {
  return chrome.runtime.lastError?.message;
}
