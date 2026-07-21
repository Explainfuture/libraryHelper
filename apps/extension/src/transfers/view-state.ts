import type { StoredTransfer } from "../storage/transfers";

export type TransferViewState =
  "active" | "cancelled" | "completed" | "expired";

export function getTransferViewState(
  transfer: StoredTransfer,
  now: number,
): TransferViewState {
  if (transfer.status === "completed") {
    return "completed";
  }
  if (transfer.status === "cancelled") {
    return "cancelled";
  }
  return now >= transfer.expiresAt ? "expired" : "active";
}
