# BookBridge

BookBridge 是一个纯浏览器的 EPUB 点对点传输工具。Chrome 扩展发现下载完成的 EPUB
后，会打开扩展自己的传输窗口。用户只需为常用保存目录授予一次只读权限，之后插件
会自动读取刚下载的 EPUB 并显示二维码；手机扫码打开静态接收页，再通过 WebRTC 加密
连接直接接收内容。

BookBridge 不注入网页，不读取 Cookie、账号、密码、Authorization Header 或正文，
只会在用户明确授权的目录根层级按下载文件名和大小查找 EPUB，不递归扫描目录，不读取
其他文件，也不把 EPUB 上传到 GitHub Pages、PeerJS 配对服务或云端存储。

> 只传输你有权使用的文件。

## 工作方式

1. Manifest V3 扩展监听 Chrome 已完成的下载，只响应 `.epub` 或
   `application/epub+zip`。
2. 扩展打开内部的 `chrome-extension://…/transfer.html`，只在本地查询参数中附带
   文件名和大小，不向 GitHub Pages 发送这些信息。
3. 用户可以添加任意盘符下的多个常用保存目录。扩展将只读目录句柄保存在自身
   IndexedDB 中；下载完成后以文件名和大小直接匹配根层级文件。未匹配时仍可手动选择。
4. 插件检查 ZIP 签名、`mimetype` 和 `META-INF/container.xml`，且最多接受 256 MiB。
5. 插件创建十分钟有效的随机配对信息并显示二维码。iPhone 扫码后打开 GitHub Pages
   上的静态接收页；PeerJS 只负责
   WebRTC 配对信令；文件名和 EPUB 内容都在加密的数据通道中发送。
6. 手机完整接收后，可打开系统分享菜单并选择 Apple Books，或下载 EPUB。

项目不再包含 Go Native Host、Windows 注册表安装、常驻进程或本地 HTTP 服务器。

## 安装扩展

### Chrome Web Store

扩展上架后，用户可以直接点击“添加至 Chrome”。商店版本会自动更新。

### GitHub Release ZIP

Windows Chrome 不允许把 GitHub 上的 ZIP 或自托管 CRX 当作商店扩展直接安装。GitHub
版本仍可使用，但需要：

1. 下载 `BookBridge-extension.zip`。
2. 将 ZIP 解压到一个固定文件夹；Chrome 不能直接加载 ZIP。
3. 打开 `chrome://extensions`。
4. 开启“开发者模式”。
5. 点击“加载已解压的扩展程序”，选择刚解压且包含 `manifest.json` 的文件夹。

更新 GitHub 版本时，下载新 ZIP、覆盖原文件夹，然后在 `chrome://extensions` 点击
BookBridge 卡片上的“重新加载”。不需要管理员权限、注册表或防火墙配置。

## 使用

1. 第一次下载 EPUB 后，在自动打开的插件窗口中点击“添加目录”，选择这次保存 EPUB
   的目录，例如 `C:\Users\你\Downloads` 或 `E:\电子书`。
2. 插件立即自动读取同名、同大小的 EPUB 并显示二维码。
3. 以后下载到任一已授权目录时，不再选择文件，直接用 iPhone 相机扫描二维码。
4. 如果文件保存到了新目录，添加该目录一次；找不到或权限失效时也可以手动选择文件。
5. 保持电脑和手机页面打开，等待进度达到 100%，再分享到 Apple Books。

目录权限是可选的、只读的，并可在插件窗口随时移除。Chrome 回收权限后，目录会显示
“需授权”，点击“允许”即可恢复。为了避免扫描整个磁盘，BookBridge 只检查每个授权目录
的根层级；如果 EPUB 位于子目录，请直接授权那个子目录。

BookBridge 只配置 STUN，不配置 TURN 文件中继。这样可以保证 EPUB 不经过中继服务器；
代价是在某些公司网络、访客 Wi-Fi、VPN 或严格 NAT 环境下，点对点连接可能失败。同一
Wi-Fi 通常最可靠。

## 配对服务与隐私边界

- 已授权目录句柄只保存在扩展自己的 IndexedDB，不上传或同步。自动模式不列出目录内容，
  只按刚完成下载的文件名请求直接子文件，并再次核对文件大小。
- GitHub Pages 只部署手机接收页面，不包含电脑发送端，也不接受文件上传。
- 默认使用 PeerJS Cloud 做 WebRTC 信令，并使用 Google STUN 帮助两个浏览器发现连接
  路径。它们可能看到连接时间、IP 地址和随机 Peer ID 等网络元数据，但不会收到 EPUB
  内容、文件名或配对密钥。
- 配对密钥只放在二维码 URL fragment 中，并在 WebRTC 数据通道建立后验证。
- EPUB 使用 WebRTC DTLS 加密传输。
- 网页没有分析、广告、远程脚本或云端文件存储。

## 开发

需要 Node.js 22 和 pnpm 10：

```powershell
pnpm install
pnpm dev
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm dev` 同时启动：

- WXT 扩展开发环境；
- Vite 手机接收网页。

生产构建输出：

- Chrome 扩展：`apps/extension/.output/chrome-mv3`
- GitHub Pages 网页：`apps/web/dist`

生成 Chrome Web Store/GitHub 共用 ZIP：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-release.ps1
```

产物为 `dist/release/BookBridge-extension.zip`。ZIP 根目录直接包含 `manifest.json`，可
上传 Chrome Web Store；GitHub 用户则先解压再“加载已解压的扩展程序”。推送 `v*`
标签时，GitHub Actions 会创建 Release 并附加该 ZIP。

## 部署静态手机接收页

`.github/workflows/pages.yml` 会把 `apps/web` 部署到：

```text
https://explainfuture.github.io/libraryHelper/
```

首次使用前，需要在仓库 Settings → Pages 中将 Source 设为 GitHub Actions。Fork 或
重命名仓库时：

1. 将 `apps/web/.env.example` 中的 `VITE_BOOKBRIDGE_BASE_PATH` 改为新仓库路径；
2. 将 `apps/extension/.env.example` 中的 `VITE_BOOKBRIDGE_WEB_APP_URL` 改为新 Pages
   地址，并以对应环境变量重新构建扩展。

这些配置都是公开 URL，不应放入任何密钥。

## 测试与质量检查

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke-extension.ps1 -SkipBuild
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-release.ps1 -SkipBuild
```

单元测试覆盖 EPUB 下载识别、路径脱敏、下载文件大小匹配、扩展窗口参数、EPUB 校验、
严格传输消息解析和 fragment 接收路由。Chromium 端到端测试会验证手动回退以及保存目录
句柄后跳过文件选择器的自动传输流程。

正式发布前仍需在真实 Chrome 与 iPhone Safari 上完成一次目录授权、自动读取、扫码、
WebRTC 传输和 Apple Books 分享验收。

## 仓库结构

- `apps/extension` — WXT、React、TypeScript 的 Chrome 发送端
- `apps/web` — Vite、React、PeerJS 的静态手机接收页
- `packages/protocol` — 发送端与接收端共用的严格传输协议
- `scripts` — 构建、打包、图标和烟测脚本
- `docs` — 架构与发布说明

## License

[MIT](LICENSE)
