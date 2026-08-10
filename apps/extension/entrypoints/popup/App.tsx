import { useState } from "react";

import { createTransferWindowOptions } from "../../src/windows";

const FLOW_STEPS = [
  { number: "1", title: "授权一次" },
  { number: "2", title: "下载 EPUB" },
  { number: "3", title: "手机扫码" },
] as const;

export function App() {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openTransfer = async () => {
    if (opening) {
      return;
    }
    setOpening(true);
    setError(null);
    try {
      await chrome.windows.create(
        createTransferWindowOptions(new URL(chrome.runtime.getURL("/"))),
      );
      window.close();
    } catch {
      setError("无法打开传输窗口，请稍后重试。");
      setOpening(false);
    }
  };

  return (
    <main className="popup-shell">
      <header className="navigation-bar">
        <div className="brand-lockup">
          <img src="/icons/icon-48.png" alt="" width="36" height="36" />
          <strong translate="no">BookBridge</strong>
        </div>
        <span className="ready-badge">
          <span aria-hidden="true" />
          纯浏览器版
        </span>
      </header>

      <section className="intro">
        <p className="eyebrow">一次设置 · 自动传书</p>
        <h1>下载 EPUB，直接扫码</h1>
        <p>常用保存目录只授权一次；文件不上传到云端。</p>
      </section>

      <button
        className="start-button"
        type="button"
        disabled={opening}
        onClick={() => {
          void openTransfer();
        }}
      >
        {opening ? "正在打开…" : "打开传书窗口"}
      </button>
      <p className="feedback" role="status" aria-live="polite">
        {error}
      </p>

      <section className="flow-card" aria-label="使用方法">
        <ol className="flow">
          {FLOW_STEPS.map((step) => (
            <li key={step.number}>
              <span className="step-number">{step.number}</span>
              <strong>{step.title}</strong>
            </li>
          ))}
        </ol>
        <p>支持 C 盘、E 盘和多个常用保存目录。</p>
      </section>

      <footer className="privacy-note">
        <span aria-hidden="true">◆</span>
        无本地助手 · 无注册表 · 无防火墙配置
      </footer>
    </main>
  );
}
