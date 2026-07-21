import { isNativeHostUnavailable, NativeHostError } from "./native/errors";

const HOST_UNAVAILABLE_MESSAGE =
  "BookBridge 本地助手未运行，请先安装或启动本地助手。";

export async function showTransferError(error: unknown): Promise<void> {
  let message = "创建 EPUB 传输时发生错误，请稍后重试。";
  let notificationId = `bookbridge-transfer-error-${Date.now().toString()}`;
  if (isNativeHostUnavailable(error)) {
    message = HOST_UNAVAILABLE_MESSAGE;
    notificationId = "bookbridge-host-unavailable";
  } else if (error instanceof NativeHostError) {
    message = `本地助手拒绝了该 EPUB（${error.code}）。`;
  }

  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("/bookbridge.svg"),
    title: "BookBridge",
    message,
    priority: 1,
  });
}

export async function showWindowError(): Promise<void> {
  await chrome.notifications.create(
    `bookbridge-window-error-${Date.now().toString()}`,
    {
      type: "basic",
      iconUrl: chrome.runtime.getURL("/bookbridge.svg"),
      title: "BookBridge",
      message: "传输已创建，但无法打开二维码窗口。请重新下载 EPUB 后重试。",
      priority: 1,
    },
  );
}
