import { useEffect, useState } from "react";

import { TRANSFERS_KEY, TransferStore } from "../../src/storage/transfers";
import type { StoredTransfer } from "../../src/storage/transfers";

export type TransferLoadState =
  | { status: "error" }
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; transfer: StoredTransfer };

const transferStore = new TransferStore(chrome.storage.session);

export function useStoredTransfer(transferId: string): TransferLoadState {
  const [state, setState] = useState<TransferLoadState>({ status: "loading" });

  useEffect(() => {
    let subscribed = true;

    const load = async () => {
      try {
        const transfer = await transferStore.get(transferId);
        if (subscribed) {
          setState(
            transfer === undefined
              ? { status: "missing" }
              : { status: "ready", transfer },
          );
        }
      } catch {
        if (subscribed) {
          setState({ status: "error" });
        }
      }
    };
    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === "session" && TRANSFERS_KEY in changes) {
        void load();
      }
    };

    void load();
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      subscribed = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [transferId]);

  return state;
}

export function useCurrentTime(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [enabled]);

  return now;
}
