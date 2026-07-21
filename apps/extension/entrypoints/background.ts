import { DownloadCoordinator } from "../src/downloads/coordinator";
import { PendingDownloadQueue } from "../src/storage/pending-downloads";

export default defineBackground(() => {
  const pendingDownloads = new PendingDownloadQueue(chrome.storage.session);
  const coordinator = new DownloadCoordinator({
    search: async (downloadId) =>
      chrome.downloads.search({ id: downloadId }).then((items) =>
        items.map((item) => ({
          id: item.id,
          filename: item.filename,
          mime: item.mime,
        })),
      ),
    onEligible: async (download) =>
      pendingDownloads.enqueue({ ...download, detectedAt: Date.now() }),
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
