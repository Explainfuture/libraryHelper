import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

import { getReceiverPageURL } from "../../src/config";
import { validateEpub } from "../../src/epub/validate";
import { formatFileSize, getCountdown } from "../../src/format";
import type { EpubSender, SenderSnapshot } from "../../src/transfer/sender";
import {
  useDirectoryAccess,
  type DirectoryAutomation,
} from "./use-directory-access";

const QRCodeSVG = lazy(async () => {
  const module = await import("qrcode.react");
  return { default: module.QRCodeSVG };
});

type CopyState = "copied" | "error" | "idle";

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SenderSnapshot | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [automaticDirectory, setAutomaticDirectory] = useState<string | null>(
    null,
  );
  const inputReference = useRef<HTMLInputElement>(null);
  const sessionReference = useRef<EpubSender | null>(null);
  const selectionReference = useRef(0);
  const suggestedFilename = new URLSearchParams(window.location.search).get(
    "filename",
  );
  const expectedBytes = parseExpectedBytes(window.location.search);
  const now = useCurrentTime(snapshot?.phase === "waiting");

  useEffect(
    () => () => {
      sessionReference.current?.dispose();
    },
    [],
  );

  const startFile = useCallback(
    async (selected: File, sourceDirectory: string | null = null) => {
      const selection = selectionReference.current + 1;
      selectionReference.current = selection;
      sessionReference.current?.dispose();
      sessionReference.current = null;
      setFile(selected);
      setSnapshot(null);
      setCopyState("idle");
      setAutomaticDirectory(sourceDirectory);
      setValidationError(null);
      setValidating(true);

      const validation = await validateEpub(selected);
      if (selectionReference.current !== selection) {
        return;
      }
      setValidating(false);
      if (!validation.ok) {
        setValidationError(validation.message ?? "这个 EPUB 无法读取。");
        return;
      }

      try {
        const { EpubSender } = await import("../../src/transfer/sender");
        if (selectionReference.current !== selection) {
          return;
        }
        const session = new EpubSender(
          selected,
          getReceiverPageURL(),
          setSnapshot,
        );
        sessionReference.current = session;
        await session.start();
      } catch {
        // The sender snapshot contains connection errors. Configuration and
        // module errors fall back to this actionable message.
        setSnapshot(
          (current) =>
            current ?? {
              phase: "error",
              progress: 0,
              error: "无法启动传输，请检查接收页配置后重试。",
            },
        );
      }
    },
    [],
  );

  const directoryAccess = useDirectoryAccess({
    ...(expectedBytes === undefined ? {} : { expectedBytes }),
    onFile: (selected, directoryName) => {
      void startFile(selected, directoryName);
    },
    suggestedFilename,
  });

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected === undefined) {
      return;
    }
    directoryAccess.cancelPendingLookup();
    await startFile(selected);
  };

  const chooseAnother = () => {
    selectionReference.current += 1;
    sessionReference.current?.dispose();
    sessionReference.current = null;
    setFile(null);
    setSnapshot(null);
    setCopyState("idle");
    setAutomaticDirectory(null);
    setValidationError(null);
    setValidating(false);
    if (inputReference.current !== null) {
      inputReference.current.value = "";
      inputReference.current.click();
    }
  };

  const copyLink = async () => {
    if (snapshot?.shareURL === undefined) {
      return;
    }
    try {
      await navigator.clipboard.writeText(snapshot.shareURL);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  };

  const countdown =
    snapshot?.expiresAt === undefined
      ? null
      : getCountdown(snapshot.expiresAt, now).label;

  return (
    <PageShell badge={senderBadge(snapshot)}>
      <section className="hero">
        <p className="eyebrow">一次授权 · 自动传书</p>
        <h1>下载完成，直接扫码</h1>
        <p>
          为常用保存目录授予一次只读权限。以后下载
          EPUB，插件会自动读取并显示二维码。
        </p>
      </section>

      <DirectoryPanel access={directoryAccess} />

      <section className="file-card" aria-label="EPUB 文件">
        <span className="file-icon" aria-hidden="true">
          EPUB
        </span>
        <div className="file-copy">
          <strong title={file?.name ?? suggestedFilename ?? undefined}>
            {file?.name ?? suggestedFilename ?? "尚未选择文件"}
          </strong>
          <span>
            {file === null
              ? "未自动找到时仍可手动选择"
              : `${formatFileSize(file.size)} · EPUB${automaticDirectory === null ? "" : ` · 自动读取自 ${automaticDirectory}`}`}
          </span>
        </div>
        <label className="file-picker">
          {file === null ? "选择" : "更换"}
          <input
            ref={inputReference}
            type="file"
            accept=".epub,application/epub+zip"
            onChange={(event) => {
              void selectFile(event);
            }}
          />
        </label>
      </section>

      {validating ? <StatusPanel text="正在检查 EPUB 结构…" busy /> : null}
      {validationError === null ? null : (
        <StatusPanel text={validationError} tone="error" />
      )}
      {snapshot === null ? null : (
        <SenderStatus
          snapshot={snapshot}
          countdown={countdown}
          copyState={copyState}
          onCopy={() => {
            void copyLink();
          }}
          onCancel={() => {
            sessionReference.current?.cancel();
          }}
          onRetry={chooseAnother}
        />
      )}

      <PrivacyNote />
    </PageShell>
  );
}

function DirectoryPanel({ access }: { access: DirectoryAutomation }) {
  return (
    <section className="directory-panel" aria-label="自动读取目录">
      <div className="directory-heading">
        <div>
          <p className="panel-label">自动读取目录</p>
          <h2>
            {access.directories.length === 0
              ? "添加常用保存目录"
              : `已添加 ${access.directories.length.toString()} 个目录`}
          </h2>
        </div>
        {access.phase === "unsupported" ? null : (
          <button
            className="directory-add"
            type="button"
            disabled={access.busy}
            onClick={() => {
              void access.add();
            }}
          >
            添加目录
          </button>
        )}
      </div>

      <p className={`directory-message directory-message-${access.phase}`}>
        {access.busy ? <span className="spinner" aria-hidden="true" /> : null}
        <span>{access.message}</span>
      </p>

      {access.directories.length === 0 ? null : (
        <ul className="directory-list">
          {access.directories.map((directory) => (
            <li key={directory.id}>
              <div className="directory-name">
                <span aria-hidden="true">↳</span>
                <strong title={directory.name}>{directory.name}</strong>
                <small>
                  {directory.permission === "granted" ? "只读" : "需授权"}
                </small>
              </div>
              <div className="directory-actions">
                {directory.permission === "granted" ? null : (
                  <button
                    type="button"
                    disabled={access.busy}
                    onClick={() => {
                      void access.requestPermission(directory.id);
                    }}
                  >
                    允许
                  </button>
                )}
                <button
                  type="button"
                  disabled={access.busy}
                  onClick={() => {
                    void access.remove(directory.id);
                  }}
                >
                  移除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SenderStatus({
  snapshot,
  countdown,
  copyState,
  onCopy,
  onCancel,
  onRetry,
}: {
  snapshot: SenderSnapshot;
  countdown: string | null;
  copyState: CopyState;
  onCopy: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (snapshot.phase === "connecting") {
    return <StatusPanel text="正在连接配对服务…" busy />;
  }
  if (snapshot.phase === "completed") {
    return (
      <TerminalPanel
        icon="✓"
        title="已发送到手机"
        body="手机已经完整收到 EPUB，可以存入 Apple Books。"
        tone="success"
        actionLabel="再传一本"
        onAction={onRetry}
      />
    );
  }
  if (snapshot.phase === "cancelled") {
    return (
      <TerminalPanel
        icon="×"
        title="传输已取消"
        body="文件没有继续发送。"
        tone="error"
        actionLabel="重新选择"
        onAction={onRetry}
      />
    );
  }
  if (snapshot.phase === "expired" || snapshot.phase === "error") {
    return (
      <TerminalPanel
        icon="!"
        title={snapshot.phase === "expired" ? "二维码已失效" : "无法继续传输"}
        body={
          snapshot.error ??
          (snapshot.phase === "expired"
            ? "为保护文件，配对二维码只保留十分钟。"
            : "请检查网络后重新选择文件。")
        }
        tone="error"
        actionLabel="重新选择"
        onAction={onRetry}
      />
    );
  }
  if (snapshot.phase === "sending") {
    return (
      <section className="transfer-panel" aria-live="polite">
        <div className="panel-heading">
          <div>
            <p className="panel-label">正在发送</p>
            <h2>请保持插件窗口和手机页面打开</h2>
          </div>
          <strong className="percentage">
            {Math.round(snapshot.progress * 100).toString()}%
          </strong>
        </div>
        <ProgressBar value={snapshot.progress} />
        <button
          className="button button-secondary"
          type="button"
          onClick={onCancel}
        >
          取消传输
        </button>
      </section>
    );
  }
  return (
    <section className="transfer-panel">
      <div className="panel-heading">
        <div>
          <p className="panel-label">扫描二维码</p>
          <h2>用 iPhone 相机扫描</h2>
        </div>
        <p className="countdown">
          <span>剩余时间</span>
          <strong>{countdown}</strong>
        </p>
      </div>
      <div
        className="qr-stage"
        aria-label="接收二维码"
        data-share-url={snapshot.shareURL}
      >
        {snapshot.shareURL === undefined ? null : (
          <Suspense
            fallback={<span className="spinner" aria-label="生成二维码" />}
          >
            <QRCodeSVG
              value={snapshot.shareURL}
              size={176}
              level="M"
              marginSize={2}
              title="在手机上打开 BookBridge 接收页"
              bgColor="#ffffff"
              fgColor="#173a31"
            />
          </Suspense>
        )}
      </div>
      <div className="actions">
        <button
          className="button button-primary"
          type="button"
          onClick={onCopy}
        >
          {copyState === "copied" ? "已复制" : "复制接收链接"}
        </button>
        <button
          className="button button-secondary"
          type="button"
          onClick={onCancel}
        >
          取消
        </button>
      </div>
      <p className="inline-feedback" role="status">
        {copyState === "error"
          ? "复制失败，请直接扫描二维码。"
          : "等待手机连接…"}
      </p>
    </section>
  );
}

function PageShell({
  badge,
  children,
}: {
  badge: string;
  children: React.ReactNode;
}) {
  return (
    <main className="page-shell">
      <header className="navigation-bar">
        <div className="brand-lockup">
          <img src="/icons/icon-48.png" alt="" width="42" height="42" />
          <div>
            <strong translate="no">BookBridge</strong>
            <span>Extension sender</span>
          </div>
        </div>
        <span className="status-badge">{badge}</span>
      </header>
      {children}
    </main>
  );
}

function StatusPanel({
  text,
  busy = false,
  tone = "neutral",
}: {
  text: string;
  busy?: boolean;
  tone?: "error" | "neutral";
}) {
  return (
    <section
      className={`status-panel status-panel-${tone}`}
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
      目录权限仅用于读取匹配的新 EPUB；文件通过 WebRTC 加密点对点发送
    </footer>
  );
}

function senderBadge(snapshot: SenderSnapshot | null): string {
  if (snapshot === null) {
    return "等待选择";
  }
  const labels: Record<SenderSnapshot["phase"], string> = {
    cancelled: "已取消",
    completed: "已完成",
    connecting: "配对中",
    error: "连接失败",
    expired: "已失效",
    sending: "发送中",
    waiting: "等待扫码",
  };
  return labels[snapshot.phase];
}

function useCurrentTime(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [enabled]);
  return now;
}

function parseExpectedBytes(search: string): number | undefined {
  const value = new URLSearchParams(search).get("size");
  if (value === null || !/^\d+$/u.test(value)) {
    return undefined;
  }
  const bytes = Number(value);
  return Number.isSafeInteger(bytes) ? bytes : undefined;
}
