import { useEffect, useRef, useState } from "react";

import { formatFileSize } from "./format";
import { parseRoute } from "./routes";
import type { EpubReceiver, ReceiverSnapshot } from "./transfer/receiver";

export function App() {
  const route = parseRoute(window.location.hash);
  return route.kind === "receive" ? (
    <ReceiverPage peerId={route.peerId} token={route.token} />
  ) : (
    <ScanRequiredPage />
  );
}

function ScanRequiredPage() {
  return (
    <PageShell badge="手机接收端" compact>
      <section className="hero receiver-hero">
        <p className="eyebrow">BookBridge 接收页</p>
        <h1>请扫描插件中的二维码</h1>
        <p>
          电脑端的文件选择、二维码和发送进度都在 BookBridge
          插件窗口中。这个网页只在手机扫码后负责接收 EPUB。
        </p>
      </section>
      <section className="status-panel status-panel-neutral">
        <p>打开 Chrome 插件，选择 EPUB，然后用手机相机扫描二维码。</p>
      </section>
      <PrivacyNote />
    </PageShell>
  );
}

function ReceiverPage({ peerId, token }: { peerId: string; token: string }) {
  const [snapshot, setSnapshot] = useState<ReceiverSnapshot>({
    phase: "connecting",
    progress: 0,
  });
  const [shareError, setShareError] = useState<string | null>(null);
  const sessionReference = useRef<EpubReceiver | null>(null);

  useEffect(() => {
    let active = true;
    void import("./transfer/receiver").then(({ EpubReceiver }) => {
      if (!active) {
        return;
      }
      const session = new EpubReceiver(peerId, token, setSnapshot);
      sessionReference.current = session;
      session.start();
    });
    return () => {
      active = false;
      sessionReference.current?.dispose();
      sessionReference.current = null;
    };
  }, [peerId, token]);

  const shareFile = async () => {
    const file = snapshot.file;
    if (file === undefined) {
      return;
    }
    setShareError(null);
    try {
      const canShare = Reflect.get(navigator, "canShare") as unknown;
      const share = Reflect.get(navigator, "share") as unknown;
      if (
        typeof canShare === "function" &&
        typeof share === "function" &&
        (canShare as (data: ShareData) => boolean).call(navigator, {
          files: [file],
        })
      ) {
        await (share as (data: ShareData) => Promise<void>).call(navigator, {
          files: [file],
          title: file.name,
        });
        return;
      }
      downloadFile(file);
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setShareError("无法打开分享菜单，请使用下方下载按钮。");
    }
  };

  return (
    <PageShell badge={receiverBadge(snapshot.phase)} compact>
      <section className="hero receiver-hero">
        <p className="eyebrow">手机接收</p>
        <h1>{snapshot.phase === "ready" ? "EPUB 已收到" : "正在连接电脑"}</h1>
        <p>请保持电脑上的 BookBridge 插件窗口打开，直到文件完整接收。</p>
      </section>

      {snapshot.filename === undefined ? null : (
        <section className="file-card" aria-label="接收中的 EPUB">
          <span className="file-icon" aria-hidden="true">
            EPUB
          </span>
          <div className="file-copy">
            <strong>{snapshot.filename}</strong>
            <span>{formatFileSize(snapshot.size ?? 0)}</span>
          </div>
        </section>
      )}

      {snapshot.phase === "connecting" ? (
        <StatusPanel text="正在建立加密的点对点连接…" busy />
      ) : null}
      {snapshot.phase === "receiving" ? (
        <section className="transfer-panel" aria-live="polite">
          <div className="panel-heading">
            <div>
              <p className="panel-label">正在接收</p>
              <h2>不要关闭 Safari</h2>
            </div>
            <strong className="percentage">
              {Math.round(snapshot.progress * 100).toString()}%
            </strong>
          </div>
          <ProgressBar value={snapshot.progress} />
        </section>
      ) : null}
      {snapshot.phase === "ready" ? (
        <section className="terminal-panel terminal-success">
          <span className="terminal-icon" aria-hidden="true">
            ✓
          </span>
          <h2>文件完整接收</h2>
          <p>点击分享按钮，然后在系统分享菜单中选择“图书”。</p>
          <button
            className="button button-primary"
            type="button"
            onClick={() => void shareFile()}
          >
            分享到 Apple Books
          </button>
          {snapshot.file === undefined ? null : (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                if (snapshot.file !== undefined) {
                  downloadFile(snapshot.file);
                }
              }}
            >
              下载 EPUB
            </button>
          )}
          <p className="inline-feedback" role="status">
            {shareError}
          </p>
        </section>
      ) : null}
      {snapshot.phase === "cancelled" || snapshot.phase === "error" ? (
        <TerminalPanel
          icon="!"
          title={snapshot.phase === "cancelled" ? "电脑已取消传输" : "接收失败"}
          body={snapshot.error ?? "请回到电脑重新生成二维码。"}
          tone="error"
          actionLabel="重新连接"
          onAction={() => {
            window.location.reload();
          }}
        />
      ) : null}

      <PrivacyNote />
    </PageShell>
  );
}

function PageShell({
  badge,
  compact = false,
  children,
}: {
  badge: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className={`page-shell${compact ? " page-shell-compact" : ""}`}>
      <header className="navigation-bar">
        <div className="brand-lockup">
          <img
            src={`${import.meta.env.BASE_URL}bookbridge.svg`}
            alt=""
            width="42"
            height="42"
          />
          <div>
            <strong translate="no">BookBridge</strong>
            <span>Phone receiver</span>
          </div>
        </div>
        <span className="status-badge">{badge}</span>
      </header>
      {children}
    </main>
  );
}

function StatusPanel({ text, busy = false }: { text: string; busy?: boolean }) {
  return (
    <section
      className="status-panel status-panel-neutral"
      aria-busy={busy}
      aria-live="polite"
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <p>{text}</p>
    </section>
  );
}

function ProgressBar({ value }: { value: number }) {
  const normalized = Math.max(0, Math.min(1, value));
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(normalized * 100)}
    >
      <span style={{ width: `${(normalized * 100).toString()}%` }} />
    </div>
  );
}

function TerminalPanel({
  icon,
  title,
  body,
  tone,
  actionLabel,
  onAction,
}: {
  icon: string;
  title: string;
  body: string;
  tone: "error" | "success";
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <section className={`terminal-panel terminal-${tone}`} aria-live="polite">
      <span className="terminal-icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      <button
        className="button button-primary"
        type="button"
        onClick={onAction}
      >
        {actionLabel}
      </button>
    </section>
  );
}

function PrivacyNote() {
  return (
    <footer className="privacy-note">
      <span aria-hidden="true">◆</span>
      EPUB 通过 WebRTC 加密点对点发送；本页面不上传或保存文件
    </footer>
  );
}

function receiverBadge(phase: ReceiverSnapshot["phase"]): string {
  const labels: Record<ReceiverSnapshot["phase"], string> = {
    cancelled: "已取消",
    connecting: "连接中",
    error: "接收失败",
    ready: "已收到",
    receiving: "接收中",
  };
  return labels[phase];
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}
