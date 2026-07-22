# 安装 BookBridge

BookBridge 由 Chrome 扩展和一个很小的 Windows 本地助手组成。扩展负责监听 EPUB
下载和显示二维码；本地助手负责读取 Chrome 给出的绝对文件路径，并在局域网内提供五分钟的一次性下载。

## 普通用户

1. 解压完整的 BookBridge 发布包，不要只取其中一个文件。
2. 双击 `Install BookBridge.cmd`。不需要管理员权限。
3. 安装程序会打开 `chrome://extensions` 和已经安装好的扩展文件夹，并把文件夹路径复制到剪贴板。
4. 在 Chrome 中打开“开发者模式”，点击“加载已解压的扩展程序”，选择刚刚打开的 `extension` 文件夹。

无需复制扩展 ID，无需修改 JSON 或注册表，也无需安装 Node.js、pnpm 或 Go。首次出现 Windows
防火墙提示时，只允许“专用网络”。

Chrome 不允许一个未上架的扩展静默安装，也不允许扩展自身写入 Native Messaging 注册信息，因此当前发布包仍保留第 4 步的 Chrome 确认。将来上架 Chrome Web Store 后，这一步可以替换为“添加至 Chrome”。

## 从源码安装

安装 Node.js 22、pnpm 10 和 Go 1.24 后，在仓库根目录直接双击 `Install BookBridge.cmd`；脚本会自动构建再执行相同安装流程。

## 卸载

先从 Chrome 移除 BookBridge，然后双击 `Uninstall BookBridge.cmd`。
