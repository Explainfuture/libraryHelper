const PRIVACY_POINTS = [
  "只处理 Chrome 已下载到本地的 EPUB",
  "不读取网页、Cookie 或账号信息",
  "不会把文件上传到云端",
] as const;

export function App() {
  return (
    <main className="card">
      <div className="mark" aria-hidden="true">
        BB
      </div>
      <p className="eyebrow">本地 EPUB 传输</p>
      <h1>BookBridge</h1>
      <p className="summary">
        扩展已就绪。完成 EPUB 下载后，BookBridge
        会在本机识别文件并交给本地助手。
      </p>
      <ul>
        {PRIVACY_POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <p className="next-step">手机和电脑需要连接同一个局域网。</p>
    </main>
  );
}
