import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "BookBridge",
    description: "将本地下载的 EPUB 安全传输到同一局域网中的手机。",
    permissions: [
      "downloads",
      "nativeMessaging",
      "notifications",
      "storage",
      "windows",
    ],
  },
});
