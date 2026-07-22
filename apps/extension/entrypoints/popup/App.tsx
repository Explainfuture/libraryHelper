import { useEffect, useState } from "react";

import type { BookBridgeRuntimeState } from "../../src/lifecycle/controller";
import { parseRuntimeStateResponse } from "../../src/runtime/messages";

const FLOW_STEPS = [
  { number: "1", title: "下载" },
  { number: "2", title: "扫码" },
  { number: "3", title: "阅读" },
] as const;

export function App() {
  const [runtimeState, setRuntimeState] =
    useState<BookBridgeRuntimeState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const state = await requestRuntimeState({ type: "GET_RUNTIME_STATE" });
        if (mounted) {
          setRuntimeState(state);
          setError(null);
        }
      } catch {
        if (mounted) {
          setError("无法读取运行状态");
        }
      }
    };
    const handleStorageChange = () => {
      void refresh();
    };
    void refresh();
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      mounted = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const toggleEnabled = async () => {
    if (runtimeState === null || pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const state = await requestRuntimeState({
        type: "SET_ENABLED",
        enabled: !runtimeState.enabled,
      });
      setRuntimeState(state);
    } catch {
      setError("切换失败，请重试");
    } finally {
      setPending(false);
    }
  };

  const badge = getBadge(runtimeState, error);

  return (
    <main className="popup-shell">
      <header className="navigation-bar">
        <div className="brand-lockup">
          <img src="/icons/icon-48.png" alt="" width="36" height="36" />
          <strong translate="no">BookBridge</strong>
        </div>
        <span className={`ready-badge ready-badge-${badge.tone}`}>
          <span aria-hidden="true" />
          {badge.label}
        </span>
      </header>

      <section className="intro">
        <p className="eyebrow">本地传书</p>
        <h1>把 EPUB 送到 iPhone</h1>
        <p>下载后自动出现二维码，不经过云端。</p>
      </section>

      <section className="settings-group" aria-label="本地助手">
        <ServiceControl
          state={runtimeState}
          pending={pending}
          error={error}
          onReload={() => {
            chrome.runtime.reload();
          }}
          onToggle={() => {
            void toggleEnabled();
          }}
        />
      </section>

      <section className="flow-card" aria-label="使用方法">
        <ol className="flow">
          {FLOW_STEPS.map((step) => (
            <li key={step.number}>
              <span className="step-number">{step.number}</span>
              <strong>{step.title}</strong>
            </li>
          ))}
        </ol>
        <p>在 Chrome 下载 EPUB，接着用 iPhone 扫码。</p>
      </section>

      <footer className="privacy-note">
        <span aria-hidden="true">◆</span>
        文件只在局域网内传输
      </footer>
    </main>
  );
}

function ServiceControl({
  state,
  pending,
  error,
  onReload,
  onToggle,
}: {
  state: BookBridgeRuntimeState | null;
  pending: boolean;
  error: string | null;
  onReload: () => void;
  onToggle: () => void;
}) {
  const enabled = state?.enabled ?? false;
  const running = state?.serverState === "running";
  const title =
    error !== null
      ? "需要重新加载"
      : state === null
        ? "正在连接…"
        : !enabled
          ? "已暂停"
          : running
            ? "正在传输"
            : "已开启";
  const detail =
    error !== null
      ? "安装更新后，重新加载扩展即可"
      : state === null
        ? "正在读取运行状态…"
        : !enabled
          ? "不会响应新的 EPUB 下载，本地助手已关闭"
          : running
            ? `${state.activeTransferCount.toString()} 个临时链接正在提供服务`
            : "下载 EPUB 时自动启动，结束后关闭";

  return (
    <div className={`service-control ${enabled ? "" : "service-paused"}`}>
      <div className="service-copy" aria-live="polite">
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {error === null ? (
        <button
          className="service-switch"
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-busy={pending}
          aria-label={enabled ? "暂停 BookBridge" : "启用 BookBridge"}
          disabled={state === null || pending}
          onClick={onToggle}
        >
          <span className="switch-track" aria-hidden="true">
            <span />
          </span>
        </button>
      ) : (
        <button className="reload-button" type="button" onClick={onReload}>
          重新加载
        </button>
      )}
    </div>
  );
}

function getBadge(
  state: BookBridgeRuntimeState | null,
  error: string | null,
): {
  label: string;
  tone: "idle" | "running" | "paused" | "warning";
} {
  if (error !== null) {
    return { label: "需重载", tone: "warning" };
  }
  if (state === null) {
    return { label: "连接中", tone: "paused" };
  }
  if (!state.enabled) {
    return { label: "已暂停", tone: "paused" };
  }
  if (state.serverState === "running") {
    return { label: "传输中", tone: "running" };
  }
  return { label: "已开启", tone: "idle" };
}

async function requestRuntimeState(
  command:
    { type: "GET_RUNTIME_STATE" } | { type: "SET_ENABLED"; enabled: boolean },
): Promise<BookBridgeRuntimeState> {
  const rawResponse: unknown = await chrome.runtime.sendMessage(command);
  const response = parseRuntimeStateResponse(rawResponse);
  if (response === null || !response.ok) {
    throw new Error(response?.error.message ?? "invalid runtime response");
  }
  return response.state;
}
