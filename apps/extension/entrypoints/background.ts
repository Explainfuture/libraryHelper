import { DownloadCoordinator } from "../src/downloads/coordinator";
import { getFilename } from "../src/files/names";
import { showWindowError } from "../src/notifications";
import { createTransferWindowOptions } from "../src/windows";

export default defineBackground(() => {
  const coordinator = new DownloadCoordinator({
    search: async (downloadId) =>
      chrome.downloads.search({ id: downloadId }).then((items) =>
        items.map((item) => ({
          id: item.id,
          filename: item.filename,
          fileSize: item.fileSize,
          mime: item.mime,
        })),
      ),
    onEligible: async (download) => {
      try {
        await chrome.windows.create(
          createTransferWindowOptions(
            new URL(chrome.runtime.getURL("/")),
            getFilename(download.filename),
            download.fileSize,
          ),
        );
      } catch (error: unknown) {
        console.error("BookBridge failed to open the transfer window", error);
        try {
          await showWindowError();
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
