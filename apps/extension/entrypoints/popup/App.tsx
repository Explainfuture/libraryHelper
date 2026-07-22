const FLOW_STEPS = [
  { number: "01", title: "下载 EPUB", detail: "像平时一样在 Chrome 完成下载" },
  {
    number: "02",
    title: "扫描二维码",
    detail: "BookBridge 会自动打开传输窗口",
  },
  {
    number: "03",
    title: "存入图书",
    detail: "在 iPhone 上用 Apple Books 打开",
  },
] as const;

export function App() {
  return (
    <main className="popup-shell">
      <header className="brand-row">
        <div className="brand-lockup">
          <img src="/icons/icon-48.png" alt="" width="42" height="42" />
          <div>
            <strong translate="no">BookBridge</strong>
            <span>本地 EPUB 传输</span>
          </div>
        </div>
        <span className="ready-badge">
          <span aria-hidden="true" />
          已启用
        </span>
      </header>

      <section className="hero">
        <p className="eyebrow">DOWNLOAD · SCAN · READ</p>
        <h1>下载完成，二维码自动出现</h1>
        <p className="summary">
          无需上传云端。EPUB 只在电脑与手机之间的局域网内传输。
        </p>
      </section>

      <ol className="flow" aria-label="使用步骤">
        {FLOW_STEPS.map((step) => (
          <li key={step.number}>
            <span className="step-number">{step.number}</span>
            <span className="step-copy">
              <strong>{step.title}</strong>
              <span>{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <footer className="privacy-note">
        <span aria-hidden="true">✓</span>
        不读取网页、Cookie 或账号信息
      </footer>
    </main>
  );
}
