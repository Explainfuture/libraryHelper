export interface TransferWindowOptions {
  focused: true;
  height: 720;
  type: "popup";
  url: string;
  width: 440;
}

export function createTransferWindowOptions(
  extensionBaseURL: URL,
  suggestedFilename?: string,
  expectedBytes?: number,
): TransferWindowOptions {
  const url = new URL("transfer.html", extensionBaseURL);
  if (suggestedFilename !== undefined && suggestedFilename !== "") {
    url.searchParams.set("filename", suggestedFilename);
  }
  if (
    expectedBytes !== undefined &&
    Number.isSafeInteger(expectedBytes) &&
    expectedBytes >= 0
  ) {
    url.searchParams.set("size", expectedBytes.toString());
  }
  return {
    focused: true,
    height: 720,
    type: "popup",
    url: url.toString(),
    width: 440,
  };
}
