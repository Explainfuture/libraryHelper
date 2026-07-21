import { DownloadCoordinator } from "../src/downloads/coordinator";
import {
  connectBookBridgeNativePort,
  getChromeRuntimeLastError,
} from "../src/native/chrome-port";
import { NativeClient } from "../src/native/client";
import { showTransferError } from "../src/notifications";
import { PendingDownloadQueue } from "../src/storage/pending-downloads";
import { TransferStore } from "../src/storage/transfers";
import { TransferService } from "../src/transfers/service";

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
      try {
        await transferService.create(download);
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
