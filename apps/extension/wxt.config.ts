import { readFileSync } from "node:fs";

import { defineConfig } from "wxt";

interface ExtensionIdentity {
  extensionId: string;
  manifestKey: string;
}

const identity = JSON.parse(
  readFileSync(
    new URL("../../config/extension-identity.json", import.meta.url),
    "utf8",
  ),
) as ExtensionIdentity;

if (!/^[a-p]{32}$/.test(identity.extensionId) || !identity.manifestKey) {
  throw new Error("BookBridge extension identity is invalid.");
}

export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    key: identity.manifestKey,
    name: "BookBridge",
    description: "常用保存目录授权一次，下载 EPUB 后自动显示手机接收二维码。",
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
    permissions: ["downloads", "notifications", "windows"],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src 'self' https://0.peerjs.com wss://0.peerjs.com",
    },
  },
});
