import { describe, expect, it, vi } from "vitest";

import { DownloadCoordinator } from "./coordinator";

describe("DownloadCoordinator", () => {
  it("searches and emits a completed EPUB once", async () => {
    const search = vi.fn(() =>
      Promise.resolve([
        {
          id: 7,
          filename: String.raw`C:\Downloads\book.EPUB`,
          fileSize: 12_345,
          mime: "application/epub+zip",
        },
      ]),
    );
    const onEligible = vi.fn(() => Promise.resolve());
    const coordinator = new DownloadCoordinator({ search, onEligible });

    await expect(
      coordinator.handle({ id: 7, state: "in_progress" }),
    ).resolves.toBe(false);
    await expect(
      coordinator.handle({ id: 7, state: "complete" }),
    ).resolves.toBe(true);
    await expect(
      coordinator.handle({ id: 7, state: "complete" }),
    ).resolves.toBe(false);
    expect(search).toHaveBeenCalledTimes(1);
    expect(onEligible).toHaveBeenCalledWith({
      downloadId: 7,
      filename: String.raw`C:\Downloads\book.EPUB`,
      fileSize: 12_345,
    });
  });

  it("does not emit non-EPUB downloads", async () => {
    const onEligible = vi.fn(() => Promise.resolve());
    const coordinator = new DownloadCoordinator({
      search: () =>
        Promise.resolve([
          { id: 2, filename: String.raw`C:\Downloads\document.pdf` },
        ]),
      onEligible,
    });

    await expect(
      coordinator.handle({ id: 2, state: "complete" }),
    ).resolves.toBe(false);
    expect(onEligible).not.toHaveBeenCalled();
  });

  it("releases the ID when an operational dependency fails", async () => {
    const search = vi
      .fn<() => Promise<readonly []>>()
      .mockRejectedValueOnce(new Error("Chrome search failed"))
      .mockResolvedValueOnce([]);
    const coordinator = new DownloadCoordinator({
      search,
      onEligible: () => Promise.resolve(),
    });

    await expect(
      coordinator.handle({ id: 9, state: "complete" }),
    ).rejects.toThrow("Chrome search failed");
    await expect(
      coordinator.handle({ id: 9, state: "complete" }),
    ).resolves.toBe(false);
    expect(search).toHaveBeenCalledTimes(2);
  });
});
