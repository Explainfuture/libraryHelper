import { useState } from "react";
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
        <span className="logo" aria-hidden="true">
          B
        </span>
        <div>
          <p className="eyebrow">本地安全传输</p>
          <h1>BookBridge</h1>
        </div>
        <StatusBadge state={viewState} />
      </header>

      <section className="file-card" aria-label="EPUB 文件信息">
        <div className="file-icon" aria-hidden="true">
          EPUB
        </div>
        <div className="file-copy">
          <h2 title={transfer.filename}>{transfer.filename}</h2>
          <p>{formatFileSize(transfer.size)}</p>
        </div>
      </section>

      {viewState === "active" ? (
        <>
          <section className="qr-card" aria-label="传输二维码">
            <QRCodeSVG
              value={transfer.url}
              size={194}
              level="M"
              marginSize={2}
              title={`下载 ${transfer.filename}`}
              bgColor="#ffffff"
              fgColor="#153f35"
            />
          </section>
          <p className="countdown" aria-live="polite">
            剩余有效时间 <strong>{countdown.label}</strong>
          </p>
          <p className="link" title={transfer.url}>
            {transfer.url}
          </p>
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
        </>
      ) : (
        <TerminalState state={viewState} />
      )}

      <p className="lan-tip">
        <span aria-hidden="true">⌁</span>
        手机和电脑必须连接同一局域网
      </p>
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
  return <span className={`status status-${state}`}>{labels[state]}</span>;
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
      <span className="logo logo-large" aria-hidden="true">
        B
      </span>
      <h1>BookBridge</h1>
      <p className="unavailable" role="status">
        {message}
      </p>
    </main>
  );
}
