# BookBridge

BookBridge 是一个开源、Windows 优先的本地 EPUB 传输工具。用户在 Chrome
中正常下载 EPUB 后，扩展会把文件交给本机 Go 助手；助手只在局域网中创建
一个五分钟临时地址，扩展自动弹出二维码窗口，iPhone 扫码即可下载原始
EPUB，并从“文件”应用交给 Apple Books 打开。

BookBridge 与书籍网站完全解耦：不注入网页、不读取 Cookie、账号、密码、
Authorization Header 或正文，不绕过网站下载限制，也不会把文件上传到云端。

> 只传输你有权使用的文件。

## 工作方式

1. Manifest V3 扩展监听 Chrome 已完成的下载，只接受 `.epub` 或
   `application/epub+zip`。
2. 扩展通过一个持久 Native Messaging 连接把本地路径发给
   `com.bookbridge.host`。
3. Go 助手校验 EPUB/ZIP 结构，在 RFC1918 私有 IPv4 地址上创建一次性临时
   session。
4. 扩展从 `chrome.storage.session` 读取不含本地路径的公开传输信息，显示本地
   SVG 二维码、文件信息、倒计时、复制和取消操作。
5. 手机完成文件下载后，Host 标记 session 为 completed，并把完成事件推送给
   扩展。

## 环境要求

- Windows 10/11
- Chrome
- 与电脑处于同一 Wi-Fi 的 iPhone

不需要管理员权限、Docker、数据库、云服务或常驻 Node.js 进程。正式运行时
只有独立的 Go Native Host 进程由 Chrome 按需启动。从源码构建时才需要
Go 1.24、Node.js 22 和 pnpm 10；发布包不需要开发工具链。

## 安装

解压发布包后双击 `Install BookBridge.cmd`。安装程序会自动安装 Native Host、复制
固定 ID 的扩展、打开 `chrome://extensions` 和扩展文件夹，并把文件夹路径复制到
剪贴板。然后只需：

1. 在 Chrome 启用“开发者模式”。
2. 点击“加载已解压的扩展程序”，选择安装程序打开的 `extension` 文件夹。

不需要复制 Extension ID、编辑 JSON 或执行 PowerShell 命令。从源码安装时也可以
直接双击仓库根目录的 `Install BookBridge.cmd`，脚本会先完成构建。

Chrome 的安全模型不允许未上架扩展静默完成最后一次确认，也不允许扩展自身安装
Native Messaging Host，因此当前最简流程仍保留上面的两个 Chrome 点击。未来上架
Chrome Web Store 后，可把它替换为“添加至 Chrome”，本地助手仍由安装包自动处理。

安装脚本把扩展、`bookbridge-host.exe` 与严格限制 `allowed_origins` 的 manifest
写入 `%LOCALAPPDATA%\BookBridge`，并仅在当前用户的以下注册表位置注册：

```text
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.bookbridge.host
```

如果 Windows 防火墙第一次弹出提示，只允许“专用网络”，不要允许公用网络。

如果误选了公用网络，可在管理员 PowerShell 中运行下面的可选加固脚本。它只修改
程序路径精确等于 `%LOCALAPPDATA%\BookBridge\bookbridge-host.exe` 的入站允许规则，
不会改变 Windows 的网络类别或其他程序规则：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\set-firewall-private.ps1
```

## 使用

1. 确认 iPhone 与电脑连接同一个 Wi-Fi；访客网络、AP 隔离或 VPN 可能阻止两台
   设备互访。
2. 在 Chrome 中正常下载一个有效 EPUB。
3. 下载完成后等待 BookBridge 自动打开二维码窗口。
4. 用 iPhone 相机扫码，在 Safari 页面点击“下载 EPUB”。
5. 在 iOS“文件”应用的“下载项”中找到文件，使用“共享”或长按菜单选择“图书”/
   Apple Books。

链接默认五分钟失效，只允许完整下载一次；取消、过期或成功下载后不能继续取得
文件。`HEAD` 请求和页面预览不会消耗下载次数。

## 开发

常用命令：

```powershell
pnpm install
pnpm dev
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm dev` 会启动 WXT 开发服务器，同时构建并监听 Go Native Host 源码。Native
Host 不能像普通服务器一样手动启动；Chrome 会根据 Native Messaging 注册信息
启动它。WXT 构建使用仓库内的固定扩展身份，开发脚本会自动注册对应的 Native
Host，不再需要复制 Extension ID：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev.ps1
```

这会把当前用户注册表临时指向 `dist\native-host\bookbridge-host.exe`。结束开发后可
重新运行 `install-host.ps1` 恢复 `%LOCALAPPDATA%` 中的稳定构建。

`scripts\build.ps1` 生成：

- Chrome 扩展：`apps\extension\.output\chrome-mv3`
- Native Host：`dist\native-host\bookbridge-host.exe`

这些目录是构建产物，不会提交到 Git。

要生成不依赖 Node.js、pnpm 或 Go 的 Windows 发布包，执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-release.ps1
```

产物为 `dist\release\BookBridge-windows-x64.zip`。
GitHub Actions 中的 `Windows release package` 也可以手动生成可下载构建产物；推送
`v*` 标签时会自动创建 GitHub Release 并附加该 ZIP。

构建脚本会从仓库内的 BookBridge 图形生成 Chrome 所需的 16/32/48/128 px PNG
图标。要快速验证 WXT 和 Go 的并行开发流程会启动且能被干净关闭，可运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev.ps1 -SmokeTest
```

## 测试与质量检查

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
go test ./...
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke-extension.ps1 -SkipBuild
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke-paths.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-release.ps1 -SkipBuild
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\smoke-install.ps1
```

Vitest 覆盖 EPUB 识别、下载去重、Native Messaging 超时/重连/协议校验、session
存储、窗口参数、倒计时和取消编排。Go 测试覆盖长度前缀协议、EPUB 校验、随机
token/session 生命周期、HTTP 安全头、中文文件名、无效 token、HEAD 语义、HTML
转义、限流、panic 隔离和网卡过滤。单元测试不依赖真实 Chrome 或真实网络环境。

`smoke-extension.ps1` 使用隔离的 Chromium 配置目录加载生产扩展，检查构建后的
manifest 只含五项最小权限、没有 `host_permissions`、使用 PNG 图标，并确认 MV3
Service Worker 与 popup 实际启动。烟测还会创建传输 popup，验证中文文件名、大小、
二维码、倒计时、复制/取消按钮、局域网提示，以及取消、完成和过期终态；测试数据只
写入隔离浏览器的 `chrome.storage.session`，不会修改用户的 Chrome 配置。脚本优先
使用本机 Playwright Chromium，也可用 `-ChromePath` 指定兼容的 Chromium executable。
`smoke-paths.ps1` 会从仓库内的临时中文及空格路径执行完整构建，并校验 Native
Messaging manifest 能无损保存该绝对路径。`smoke-install.ps1` 会从生成的 ZIP
解压发布包，在临时中文及空格路径中执行无开发工具链的安装，并验证固定扩展 ID、
严格 `allowed_origins`、文件复制和隔离测试注册表项，随后清理测试数据。

正式发布前仍须按“安装”和“使用”章节在真实 Google Chrome 中手动加载扩展，确认
Windows 防火墙只允许专用网络，并用同一 Wi-Fi 下的真实 iPhone 完成一次扫码、下载与
Apple Books 打开流程。自动化 Chromium 烟测不能替代这三项人工验收。

仓库提供一个不含书籍正文的本地测试 EPUB 和临时下载页生成器，便于执行上述真实
Chrome 验收。服务器只监听 loopback；完成浏览器下载后应立即停止：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\manual-acceptance-fixture.ps1
# 在 Chrome 打开脚本输出的 URL 并下载测试 EPUB
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\manual-acceptance-fixture.ps1 -Stop
```

## 常见问题

### 提示“BookBridge 本地助手未运行”

- 重新双击 `Install BookBridge.cmd`，然后在 `chrome://extensions` 重新加载扩展。
- 确认加载的是 `%LOCALAPPDATA%\BookBridge\extension`；固定扩展 ID 应为
  `hmdckfnmfjkcbacphammiaelinplkkfb`。
- 在扩展卡片的“Service worker”检查错误日志。
- 确认 manifest 中的 executable 路径仍然存在，且安全软件没有隔离它。

### 下载 EPUB 后没有二维码

- 确认 Chrome 下载状态已经完成，文件后缀是 `.epub`，而不是 `.crdownload`、
  `.part` 或 `.tmp`。
- BookBridge 会拒绝空文件、符号链接、非 ZIP 文件，以及缺少
  `META-INF/container.xml` 的伪 EPUB。
- 查看扩展通知和 Service worker 日志中的结构化错误。

### 手机打不开二维码地址

- 两台设备必须在同一私有局域网，且不能处于启用了客户端隔离的访客 Wi-Fi。
- 暂停可能接管路由的 VPN，再重试。
- Windows 网络配置应为“专用网络”，防火墙弹窗只勾选专用网络。
- 如果电脑没有可用的 `10/8`、`172.16/12` 或 `192.168/16` IPv4 地址，Host 会
  返回 `NO_LAN_ADDRESS`。
- 链接可能已经过期、取消或完成；重新下载 EPUB 会创建新链接。

### 端口 18321 被占用

Host 会在有限范围内尝试后续端口。二维码始终包含实际选中的端口，不需要手动
修改地址。

## 卸载

先关闭 BookBridge 二维码窗口并在 Chrome 中移除扩展，然后双击
`Uninstall BookBridge.cmd`。

卸载脚本只删除 BookBridge 的当前用户注册表项、扩展目录、`bookbridge-host.exe`
和生成的 manifest。如果安装目录包含其他文件，它会保留目录和未知文件并给出警告。

如果 Windows 曾为 Host 创建防火墙规则，再在管理员 PowerShell 中执行下面的命令以
删除程序路径精确匹配 BookBridge 的规则；没有匹配规则时该命令也可安全重复运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\set-firewall-private.ps1 -Remove
```

## 仓库结构

- `apps/extension` — WXT、React、TypeScript 的 Chrome 扩展
- `apps/native-host` — Go Native Host、EPUB 校验、session 与局域网 HTTP 服务
- `scripts` — Windows 构建、安装、卸载和开发脚本
- `docs` — 实施状态与架构说明

## 安全边界

- 扩展只申请 `downloads`、`nativeMessaging`、`notifications`、`storage` 和
  `windows`，没有 `host_permissions`。
- HTTP 服务只提供随机 token 对应的已校验 EPUB，不提供目录、上传、任意路径、
  CORS 或调试接口。
- token 使用至少 32 字节的 `crypto/rand` 数据；内存中只保存 SHA-256 哈希并用
  常量时间比较。
- 手机页面不加载外部 JavaScript、字体、统计、CDN 或第三方资源，并设置 CSP、
  `no-referrer`、`nosniff` 和 `no-store`。
- Native Messaging stdout 只承载长度前缀 JSON 协议，诊断只写 stderr。

## License

[MIT](LICENSE)
