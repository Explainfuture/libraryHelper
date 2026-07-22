import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { formatFileSize, getCountdown } from "../../src/format";
import { parseRuntimeResponse } from "../../src/runtime/messages";
import type { StoredTransfer } from "../../src/storage/transfers";
import { getTransferViewState } from "../../src/transfers/view-state";
import { useCurrentTime, useStoredTransfer } from "./use-transfer";

export interface AppProperties {
  transferId: string | null;
}

export function App({ transferId }: AppProperties) {
  if (transferId === null || transferId === "") {
    return <Unavailable message="传输地址无效。请重新下载 EPUB。" />;
  }
  return <TransferDetails transferId={transferId} />;
}

function TransferDetails({ transferId }: { transferId: string }) {
  const loadState = useStoredTransfer(transferId);
  const transfer =
    loadState.status === "ready" ? loadState.transfer : undefined;
  const now = useCurrentTime(transfer?.status === "active");

  if (loadState.status === "loading") {
    return <Unavailable message="正在准备二维码…" busy />;
  }
  if (loadState.status === "error") {
    return <Unavailable message="无法读取传输信息，请关闭窗口后重试。" />;
  }
  if (loadState.status === "missing") {
    return <Unavailable message="找不到该传输，它可能已经失效。" />;
  }
  return <TransferCard transfer={loadState.transfer} now={now} />;
}

function TransferCard({
  transfer,
  now,
}: {
  transfer: StoredTransfer;
  now: number;
}) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [cancelState, setCancelState] = useState<"idle" | "pending" | "error">(
    "idle",
  );
  const viewState = getTransferViewState(transfer, now);
  const countdown = getCountdown(transfer.expiresAt, now);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [viewState]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(transfer.url);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  const cancelTransfer = async () => {
    setCancelState("pending");
    try {
      const rawResponse: unknown = await chrome.runtime.sendMessage({
        type: "CANCEL_TRANSFER",
        transferId: transfer.transferId,
      });
      const response = parseRuntimeResponse(rawResponse);
      if (response === null || !response.ok) {
        setCancelState("error");
        return;
      }
      setCancelState("idle");
    } catch {
      setCancelState("error");
    }
  };

  return (
    <main className="shell">
      <header className="header">
        <div className="brand">
          <img
            className="brand-mark"
            src="/icons/icon-48.png"
            alt=""
            width="44"
            height="44"
          />
          <div>
            <p className="eyebrow">本地安全传输</p>
            <h1 translate="no">BookBridge</h1>
          </div>
        </div>
        <StatusBadge state={viewState} />
      </header>

      <section className="file-card" aria-label="EPUB 文件信息">
        <div className="file-icon" aria-hidden="true">
          <span>EPUB</span>
        </div>
        <div className="file-copy">
          <p className="file-label">EPUB 文档</p>
          <h2 title={transfer.filename}>{transfer.filename}</h2>
          <p className="file-meta">{formatFileSize(transfer.size)} · EPUB</p>
        </div>
      </section>

      {viewState === "active" ? (
        <section className="transfer-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-label">扫描二维码</p>
              <h2>用 iPhone 相机扫描</h2>
            </div>
            <p className="countdown" aria-live="polite">
              <span>剩余有效时间</span>
              <strong>{countdown.label}</strong>
            </p>
          </div>

          <section className="qr-stage" aria-label="传输二维码">
            <div className="qr-card">
              <QRCodeSVG
                value={transfer.url}
                size={128}
                level="M"
                marginSize={2}
                title={`下载 ${transfer.filename}`}
                bgColor="#ffffff"
                fgColor="#173a31"
              />
            </div>
          </section>

          <div className="link-row">
            <span>局域网链接</span>
            <code title={transfer.url}>{transfer.url}</code>
          </div>

          <div className="actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                void copyLink();
              }}
            >
              {copyStatus === "copied" ? "已复制" : "复制链接"}
            </button>
            <button
              className="button button-secondary"
              type="button"
              disabled={cancelState === "pending"}
              onClick={() => {
                void cancelTransfer();
              }}
            >
              {cancelState === "pending" ? "正在取消…" : "取消传输"}
            </button>
          </div>
          <p className="feedback" role="status" aria-live="polite">
            {copyStatus === "error" && "复制失败，请手动选择上方链接。"}
            {cancelState === "error" && "取消失败，请确认本地助手正在运行。"}
          </p>
        </section>
      ) : (
        <TerminalState state={viewState} />
      )}

      <footer className="lan-tip">
        <span className="lan-icon" aria-hidden="true">
          ⌁
        </span>
        <span>
          <strong>点对点本地传输</strong>
          手机和电脑必须连接同一局域网
        </span>
      </footer>
    </main>
  );
}

function StatusBadge({
  state,
}: {
  state: ReturnType<typeof getTransferViewState>;
}) {
  const labels = {
    active: "等待扫码",
    cancelled: "已取消",
    completed: "已完成",
    expired: "已失效",
  } as const;
  return (
    <span className={`status status-${state}`}>
      <span className="status-dot" aria-hidden="true" />
      {labels[state]}
    </span>
  );
}

function TerminalState({
  state,
}: {
  state: Exclude<ReturnType<typeof getTransferViewState>, "active">;
}) {
  const content = {
    cancelled: { icon: "×", title: "传输已取消", body: "该链接已无法访问。" },
    completed: {
      icon: "✓",
      title: "已发送到手机",
      body: "EPUB 已成功下载，此链接不会再次提供文件。",
    },
    expired: {
      icon: "⌛",
      title: "链接已失效",
      body: "临时链接已过期，请重新下载 EPUB 以创建新传输。",
    },
  } as const;
  const selected = content[state];
  return (
    <section className="terminal" aria-live="polite">
      <span className={`terminal-icon terminal-${state}`} aria-hidden="true">
        {selected.icon}
      </span>
      <h2>{selected.title}</h2>
      <p>{selected.body}</p>
    </section>
  );
}

function Unavailable({
  message,
  busy = false,
}: {
  message: string;
  busy?: boolean;
}) {
  return (
    <main className="shell shell-centered" aria-busy={busy}>
      <img
        className="brand-mark brand-mark-large"
        src="/icons/icon-128.png"
        alt=""
        width="68"
        height="68"
      />
      <h1 translate="no">BookBridge</h1>
      <p className="unavailable" role="status">
        {message}
      </p>
    </main>
  );
}
