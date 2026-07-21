import { DownloadCoordinator } from "../src/downloads/coordinator";
import {
  connectBookBridgeNativePort,
  getChromeRuntimeLastError,
} from "../src/native/chrome-port";
import { NativeClient } from "../src/native/client";
import { isNativeHostUnavailable, NativeHostError } from "../src/native/errors";
import { showTransferError, showWindowError } from "../src/notifications";
import {
  parseCancelTransferCommand,
  type RuntimeErrorResponse,
} from "../src/runtime/messages";
import type { TransferCreatedMessage } from "../src/protocol/messages";
import { PendingDownloadQueue } from "../src/storage/pending-downloads";
import { TransferStore } from "../src/storage/transfers";
import { TransferService } from "../src/transfers/service";
import { createTransferWindowOptions } from "../src/windows";

export default defineBackground(() => {
  const pendingDownloads = new PendingDownloadQueue(chrome.storage.session);
  const transfers = new TransferStore(chrome.storage.session);
  const nativeClient = new NativeClient({
    connect: connectBookBridgeNativePort,
    getLastError: getChromeRuntimeLastError,
  });
  const transferService = new TransferService({
    nativeClient,
    pendingDownloads,
    transfers,
  });
  const coordinator = new DownloadCoordinator({
    search: async (downloadId) =>
      chrome.downloads.search({ id: downloadId }).then((items) =>
        items.map((item) => ({
          id: item.id,
          filename: item.filename,
          mime: item.mime,
        })),
      ),
    onEligible: async (download) => {
      let transfer: TransferCreatedMessage;
      try {
        transfer = await transferService.create(download);
      } catch (error: unknown) {
        try {
          await showTransferError(error);
        } catch (notificationError: unknown) {
          console.error(
            "BookBridge failed to show a notification",
            notificationError,
          );
        }
        throw error;
      }
      try {
        await chrome.windows.create(
          createTransferWindowOptions(
            chrome.runtime.getURL("/transfer.html"),
            transfer.payload.transferId,
          ),
        );
      } catch (error: unknown) {
        console.error("BookBridge failed to open the transfer window", error);
        try {
          await showWindowError();
        } catch (notificationError: unknown) {
          console.error(
            "BookBridge failed to show a window error notification",
            notificationError,
          );
        }
      }
    },
  });

  nativeClient.onTransferCompleted((message) => {
    void transferService.complete(message).catch((error: unknown) => {
      console.error("BookBridge failed to store transfer completion", error);
    });
  });
  nativeClient.start();

  chrome.runtime.onSuspend.addListener(() => {
    nativeClient.dispose();
  });

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      const command = parseCancelTransferCommand(message);
      if (command === null) {
        return false;
      }
      void transferService.cancel(command.transferId).then(
        () => {
          sendResponse({ ok: true });
        },
        (error: unknown) => {
          sendResponse(toRuntimeError(error));
        },
      );
      return true;
    },
  );

  chrome.downloads.onChanged.addListener((delta) => {
    void coordinator
      .handle({ id: delta.id, state: delta.state?.current })
      .catch((error: unknown) => {
        console.error(
          "BookBridge failed to inspect a completed download",
          error,
        );
      });
  });
});

function toRuntimeError(error: unknown): RuntimeErrorResponse {
  if (isNativeHostUnavailable(error)) {
    return {
      ok: false,
      error: {
        code: "HOST_UNAVAILABLE",
        message: "本地助手当前不可用，无法取消传输。",
      },
    };
  }
  if (error instanceof NativeHostError) {
    return {
      ok: false,
      error: { code: error.code, message: "本地助手未能取消该传输。" },
    };
  }
  return {
    ok: false,
    error: { code: "CANCEL_FAILED", message: "取消失败，请稍后重试。" },
  };
}
