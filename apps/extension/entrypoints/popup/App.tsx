import { useEffect, useState } from "react";

import type { BookBridgeRuntimeState } from "../../src/lifecycle/controller";
import { parseRuntimeStateResponse } from "../../src/runtime/messages";

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

  const badge = getBadge(runtimeState);

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
        <span className={`ready-badge ready-badge-${badge.tone}`}>
          <span aria-hidden="true" />
          {badge.label}
        </span>
      </header>

      <section className="hero">
        <p className="eyebrow">DOWNLOAD · SCAN · READ</p>
        <h1>下载完成，二维码自动出现</h1>
        <p className="summary">
          无需上传云端。EPUB 只在电脑与手机之间的局域网内传输。
        </p>
        <ServiceControl
          state={runtimeState}
          pending={pending}
          error={error}
          onToggle={() => {
            void toggleEnabled();
          }}
        />
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

function ServiceControl({
  state,
  pending,
  error,
  onToggle,
}: {
  state: BookBridgeRuntimeState | null;
  pending: boolean;
  error: string | null;
  onToggle: () => void;
}) {
  const enabled = state?.enabled ?? false;
  const running = state?.serverState === "running";
  const title =
    state === null
      ? "正在检查本地服务"
      : !enabled
        ? "BookBridge 已暂停"
        : running
          ? "本地传输正在运行"
          : "按需启动，不常驻端口";
  const detail =
    state === null
      ? "正在读取扩展状态…"
      : !enabled
        ? "不会响应新的 EPUB 下载，本地 Server 已关闭"
        : running
          ? `${state.activeTransferCount.toString()} 个临时链接正在提供服务`
          : "检测到 EPUB 下载后才启动，结束后自动关闭";

  return (
    <div className={`service-control ${enabled ? "" : "service-paused"}`}>
      <div className="service-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
        {error === null ? null : <span className="service-error">{error}</span>}
      </div>
      <button
        className="service-switch"
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? "暂停 BookBridge" : "启用 BookBridge"}
        disabled={state === null || pending}
        onClick={onToggle}
      >
        <span className="switch-track" aria-hidden="true">
          <span />
        </span>
        <span>{pending ? "处理中" : enabled ? "暂停" : "启用"}</span>
      </button>
    </div>
  );
}

function getBadge(state: BookBridgeRuntimeState | null): {
  label: string;
  tone: "idle" | "running" | "paused";
} {
  if (state === null) {
    return { label: "检查中", tone: "idle" };
  }
  if (!state.enabled) {
    return { label: "已暂停", tone: "paused" };
  }
  if (state.serverState === "running") {
    return { label: "传输中", tone: "running" };
  }
  return { label: "按需待机", tone: "idle" };
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
