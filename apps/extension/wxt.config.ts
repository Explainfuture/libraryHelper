import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "BookBridge",
    description: "将本地下载的 EPUB 安全传输到同一局域网中的手机。",
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    action: {
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png",
      },
    },
    permissions: [
      "downloads",
      "nativeMessaging",
      "notifications",
      "storage",
      "windows",
    ],
  },
});
