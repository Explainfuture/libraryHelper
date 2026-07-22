import { DownloadCoordinator } from "../src/downloads/coordinator";
import { LifecycleController } from "../src/lifecycle/controller";
import {
  connectBookBridgeNativePort,
  getChromeRuntimeLastError,
} from "../src/native/chrome-port";
import { NativeClient } from "../src/native/client";
import { isNativeHostUnavailable, NativeHostError } from "../src/native/errors";
import { showTransferError, showWindowError } from "../src/notifications";
import {
  parseCancelTransferCommand,
  parseGetRuntimeStateCommand,
  parseSetEnabledCommand,
  type RuntimeErrorResponse,
} from "../src/runtime/messages";
import type { TransferCreatedMessage } from "../src/protocol/messages";
import { PendingDownloadQueue } from "../src/storage/pending-downloads";
import { SettingsStore } from "../src/storage/settings";
import { TransferStore } from "../src/storage/transfers";
import { TransferService } from "../src/transfers/service";
import { createTransferWindowOptions } from "../src/windows";

export default defineBackground(() => {
  const pendingDownloads = new PendingDownloadQueue(chrome.storage.session);
  const transfers = new TransferStore(chrome.storage.session);
  const settings = new SettingsStore(chrome.storage.local);
  const nativeClient = new NativeClient({
    connect: connectBookBridgeNativePort,
    getLastError: getChromeRuntimeLastError,
  });
  const transferService = new TransferService({
    nativeClient,
    pendingDownloads,
    transfers,
  });
  const lifecycle = new LifecycleController({
    nativeClient,
    transfers,
    settings,
    onError: (error) => {
      console.error("BookBridge lifecycle reconciliation failed", error);
    },
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
      if (!(await lifecycle.beginTransferAttempt())) {
        return;
      }
      let transfer: TransferCreatedMessage;
      try {
        transfer = await transferService.create(download);
      } catch (error: unknown) {
        await lifecycle.transferFailed();
        const state = await lifecycle.getState();
        if (!state.enabled) {
          return;
        }
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
        await lifecycle.transferCreated();
      } catch (error: unknown) {
        console.error("BookBridge failed to schedule host shutdown", error);
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
    void transferService
      .complete(message)
      .then(() => lifecycle.transferSettled())
      .catch((error: unknown) => {
        console.error("BookBridge failed to store transfer completion", error);
      });
  });

  chrome.runtime.onSuspend.addListener(() => {
    lifecycle.dispose();
  });

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      const command = parseCancelTransferCommand(message);
      if (command === null) {
        return false;
      }
      void transferService
        .cancel(command.transferId)
        .then(async () => {
          await lifecycle.transferSettled();
          sendResponse({ ok: true });
        })
        .catch((error: unknown) => {
          sendResponse(toRuntimeError(error));
        });
      return true;
    },
  );

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      const getState = parseGetRuntimeStateCommand(message);
      if (getState !== null) {
        void lifecycle.getState().then(
          (state) => {
            sendResponse({ ok: true, state });
          },
          () => {
            sendResponse({
              ok: false,
              error: {
                code: "STATE_FAILED",
                message: "无法读取 BookBridge 运行状态。",
              },
            });
          },
        );
        return true;
      }

      const setEnabled = parseSetEnabledCommand(message);
      if (setEnabled === null) {
        return false;
      }
      void lifecycle.setEnabled(setEnabled.enabled).then(
        (state) => {
          sendResponse({ ok: true, state });
        },
        () => {
          sendResponse({
            ok: false,
            error: {
              code: "SETTINGS_FAILED",
              message: "无法更新 BookBridge 运行状态。",
            },
          });
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
