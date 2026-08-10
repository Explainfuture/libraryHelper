const DEFAULT_RECEIVER_PAGE_URL =
  "https://explainfuture.github.io/libraryHelper/";

export function getReceiverPageURL(): URL {
  const rawConfiguredURL: unknown = import.meta.env.VITE_BOOKBRIDGE_WEB_APP_URL;
  const configuredURL =
    typeof rawConfiguredURL === "string" && rawConfiguredURL.trim() !== ""
      ? rawConfiguredURL.trim()
      : DEFAULT_RECEIVER_PAGE_URL;
  const url = new URL(configuredURL);
  if (url.protocol !== "https:" && !isLoopbackHTTP(url)) {
    throw new TypeError("BookBridge receiver page URL must use HTTPS");
  }
  return url;
}

function isLoopbackHTTP(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  );
}
