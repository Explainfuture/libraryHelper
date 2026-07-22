export interface TransferWindowOptions {
  focused: true;
  height: 600;
  type: "popup";
  url: string;
  width: 420;
}

export function createTransferWindowOptions(
  transferPageURL: string,
  transferId: string,
): TransferWindowOptions {
  if (transferId === "") {
    throw new TypeError("transferId is required");
  }
  const url = new URL(transferPageURL);
  url.searchParams.set("transferId", transferId);
  return {
    focused: true,
    height: 600,
    type: "popup",
    url: url.toString(),
    width: 420,
  };
}
