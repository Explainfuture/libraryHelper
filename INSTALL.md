# 安装 BookBridge

BookBridge 现在是纯浏览器扩展，不再安装本地助手，也不写注册表或创建防火墙规则。

## Chrome Web Store

上架后直接点击“添加至 Chrome”。

## 从 GitHub 安装

Chrome 不能直接安装 GitHub ZIP。请先下载并解压 `BookBridge-extension.zip`，然后：

1. 打开 `chrome://extensions`；
2. 开启“开发者模式”；
3. 点击“加载已解压的扩展程序”；
4. 选择解压后含有 `manifest.json` 的目录。

以后更新时覆盖该目录，并在扩展管理页点击“重新加载”。卸载时直接从 Chrome 中移除
BookBridge；没有额外的本地程序需要卸载。

首次使用时，在扩展内部窗口点击“添加目录”，选择实际保存 EPUB 的目录。可以添加 C
盘、E 盘或其他盘符下的多个目录；之后下载到这些目录根层级的 EPUB 会自动显示二维码。
找不到时仍可手动选择文件，目录授权也可以随时移除。

文件读取、二维码和发送进度都在扩展内部窗口中。二维码打开的手机接收页默认位于
`https://explainfuture.github.io/libraryHelper/`；该网页不接收文件上传。仓库所有者
首次使用前需在 GitHub Settings → Pages 中选择 GitHub Actions 作为发布源。
