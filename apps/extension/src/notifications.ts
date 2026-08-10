export async function showWindowError(): Promise<void> {
  await chrome.notifications.create(
    `bookbridge-window-error-${Date.now().toString()}`,
    {
      type: "basic",
      iconUrl: chrome.runtime.getURL("/icons/icon-128.png"),
      title: "BookBridge",
      message: "无法打开 EPUB 传输窗口，请点击扩展图标后重试。",
      priority: 1,
    },
  );
}
