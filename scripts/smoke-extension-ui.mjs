import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const [portArgument, extensionId, screenshotDirectoryArgument] =
  process.argv.slice(2);
const port = Number.parseInt(portArgument ?? "", 10);
const screenshotDirectory = screenshotDirectoryArgument
  ? resolve(screenshotDirectoryArgument)
  : undefined;

if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new TypeError("A valid Chrome DevTools port is required.");
}
if (!/^[a-p]{32}$/.test(extensionId ?? "")) {
  throw new TypeError("A valid unpacked extension ID is required.");
}

const devToolsBaseURL = `http://127.0.0.1:${port}`;
const transferId = "bookbridge-browser-smoke";
const transferURL = `chrome-extension://${extensionId}/transfer.html?transferId=${transferId}`;
const publicDownloadURL =
  "http://192.168.50.25:18321/t/bookbridge-browser-smoke-token";
const transfer = {
  transferId,
  url: publicDownloadURL,
  filename: "浏览器烟测.epub",
  size: 4096,
  expiresAt: Date.now() + 4 * 60 * 1000,
  status: "active",
};

class CdpSession {
  #nextId = 1;
  #pending = new Map();
  #socket;

  static async connect(webSocketURL) {
    const socket = new WebSocket(webSocketURL);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(`Timed out connecting to CDP target: ${webSocketURL}`),
        );
      }, 10_000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          reject(new Error(`Could not connect to CDP target: ${webSocketURL}`));
        },
        { once: true },
      );
    });
    return new CdpSession(socket);
  }

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      void this.#handleMessage(event.data);
    });
    socket.addEventListener("close", () => {
      this.#rejectPending(new Error("CDP target closed unexpectedly."));
    });
    socket.addEventListener("error", () => {
      this.#rejectPending(new Error("CDP target connection failed."));
    });
  }

  send(method, parameters = {}) {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 10_000);
      this.#pending.set(id, { method, resolve, reject, timeout });
      this.#socket.send(JSON.stringify({ id, method, params: parameters }));
    });
  }

  close() {
    this.#rejectPending(new Error("CDP session closed."));
    this.#socket.close();
  }

  async #handleMessage(data) {
    const text =
      typeof data === "string"
        ? data
        : data instanceof Blob
          ? await data.text()
          : Buffer.from(data).toString("utf8");
    const message = JSON.parse(text);
    if (!Number.isSafeInteger(message.id)) {
      return;
    }
    const pending = this.#pending.get(message.id);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error !== undefined) {
      pending.reject(
        new Error(
          `CDP command ${pending.method} failed: ${message.error.message}`,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

async function listTargets() {
  const response = await fetch(`${devToolsBaseURL}/json/list`);
  if (!response.ok) {
    throw new Error(`Could not list Chrome targets: HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForTarget(predicate, description, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const target = (await listTargets()).find(predicate);
    if (target !== undefined) {
      return target;
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${description}.`);
}

async function evaluate(session, expression) {
  const response = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails !== undefined) {
    const description =
      response.exceptionDetails.exception?.description ??
      response.exceptionDetails.text ??
      "unknown JavaScript exception";
    throw new Error(`CDP evaluation failed: ${description}`);
  }
  return response.result?.value;
}

async function captureScreenshot(session, filename) {
  if (screenshotDirectory === undefined) {
    return;
  }
  mkdirSync(screenshotDirectory, { recursive: true });
  await session.send("Page.enable");
  const screenshot = await session.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  writeFileSync(
    join(screenshotDirectory, filename),
    Buffer.from(screenshot.data, "base64"),
  );
}

function storageExpression(nextTransfer) {
  const values = { "bookbridge.transfers": [nextTransfer] };
  return `chrome.storage.session.set(${JSON.stringify(values)})`;
}

async function readTransferView(pageSession) {
  return evaluate(
    pageSession,
    `(() => ({
      title: document.title,
      text: document.body?.innerText ?? "",
      href: location.href,
      qrCount: document.querySelectorAll('section[aria-label="传输二维码"] svg').length,
      qrTitle: document.querySelector('section[aria-label="传输二维码"] svg title')?.textContent ?? "",
      buttons: Array.from(document.querySelectorAll("button"), (button) => ({
        text: button.textContent?.trim() ?? "",
        type: button.type,
        disabled: button.disabled,
      })),
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: Math.max(
          document.documentElement.scrollWidth,
          document.body?.scrollWidth ?? 0,
        ),
        scrollHeight: Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight ?? 0,
        ),
      },
    }))()`,
  );
}

async function waitForView(pageSession, predicate, description) {
  const deadline = Date.now() + 5_000;
  let view;
  do {
    view = await readTransferView(pageSession);
    if (predicate(view)) {
      return view;
    }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(
    `Timed out waiting for ${description}. Last UI text: ${view?.text ?? ""}`,
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const workerTarget = await waitForTarget(
  (target) =>
    target.type === "service_worker" &&
    target.url === `chrome-extension://${extensionId}/background.js`,
  "BookBridge service worker",
);
const workerSession = await CdpSession.connect(
  workerTarget.webSocketDebuggerUrl,
);
let transferWindowId;
let pageSession;

try {
  const popupTarget = await waitForTarget(
    (target) =>
      target.type === "page" &&
      target.url === `chrome-extension://${extensionId}/popup.html`,
    "BookBridge popup page",
  );
  const popupSession = await CdpSession.connect(
    popupTarget.webSocketDebuggerUrl,
  );
  try {
    await popupSession.send("Emulation.setDeviceMetricsOverride", {
      width: 360,
      height: 580,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const popupView = await waitForView(
      popupSession,
      (view) =>
        view.text.includes("按需待机") &&
        view.text.includes("按需启动，不常驻端口"),
      "idle BookBridge popup UI",
    );
    assert(
      popupView.viewport.scrollWidth <= popupView.viewport.width &&
        popupView.viewport.scrollHeight <= popupView.viewport.height,
      `Popup UI overflows: ${JSON.stringify(popupView.viewport)}.`,
    );
    const initialSwitch = await evaluate(
      popupSession,
      `(() => {
        const control = document.querySelector('button[role="switch"]');
        return {
          count: document.querySelectorAll('button[role="switch"]').length,
          checked: control?.getAttribute("aria-checked") ?? "",
          disabled: control?.disabled ?? true,
        };
      })()`,
    );
    assert(
      initialSwitch.count === 1 &&
        initialSwitch.checked === "true" &&
        initialSwitch.disabled === false,
      `Popup switch is not enabled and accessible: ${JSON.stringify(initialSwitch)}.`,
    );
    await captureScreenshot(popupSession, "extension-popup.png");

    await evaluate(
      popupSession,
      `document.querySelector('button[role="switch"]')?.click()`,
    );
    await waitForView(
      popupSession,
      (view) =>
        view.text.includes("已暂停") &&
        view.text.includes("本地 Server 已关闭"),
      "paused BookBridge popup UI",
    );
    const pausedChecked = await evaluate(
      popupSession,
      `document.querySelector('button[role="switch"]')?.getAttribute("aria-checked")`,
    );
    assert(pausedChecked === "false", "Popup switch did not pause BookBridge.");

    await evaluate(
      popupSession,
      `document.querySelector('button[role="switch"]')?.click()`,
    );
    await waitForView(
      popupSession,
      (view) => view.text.includes("按需待机"),
      "resumed idle BookBridge popup UI",
    );
    process.stdout.write(
      "Popup lifecycle: idle, pause, immediate-stop messaging, and resume states\n",
    );
    await popupSession.send("Emulation.clearDeviceMetricsOverride");
  } finally {
    popupSession.close();
  }

  await evaluate(workerSession, storageExpression(transfer));
  const windowDetails = await evaluate(
    workerSession,
    `(async () => {
      const created = await chrome.windows.create(${JSON.stringify({
        url: transferURL,
        type: "popup",
        width: 420,
        height: 600,
        focused: true,
      })});
      return {
        id: created.id,
        type: created.type,
        width: created.width,
        height: created.height,
        focused: created.focused,
      };
    })()`,
  );
  transferWindowId = windowDetails.id;
  assert(windowDetails.type === "popup", "Transfer window is not a popup.");
  assert(
    Math.abs(windowDetails.width - 420) <= 1 &&
      Math.abs(windowDetails.height - 600) <= 1,
    `Transfer window dimensions are ${windowDetails.width}x${windowDetails.height}.`,
  );
  assert(windowDetails.focused === true, "Transfer window was not focused.");

  const pageTarget = await waitForTarget(
    (target) => target.type === "page" && target.url === transferURL,
    "BookBridge transfer page",
  );
  pageSession = await CdpSession.connect(pageTarget.webSocketDebuggerUrl);
  const activeView = await waitForView(
    pageSession,
    (view) => view.qrCount === 1 && view.text.includes("等待扫码"),
    "active transfer UI",
  );
  assert(
    activeView.title === "BookBridge 传输",
    "Transfer page title is incorrect.",
  );
  assert(
    activeView.href === transferURL && !activeView.href.includes("C:"),
    "Transfer page URL contains unexpected data.",
  );
  for (const text of [
    transfer.filename,
    "4.0 KiB",
    "剩余有效时间",
    publicDownloadURL,
    "手机和电脑必须连接同一局域网",
  ]) {
    assert(activeView.text.includes(text), `Active UI is missing: ${text}`);
  }
  assert(
    activeView.qrTitle === `下载 ${transfer.filename}`,
    "QR code is missing its accessible title.",
  );
  assert(
    JSON.stringify(activeView.buttons) ===
      JSON.stringify([
        { text: "复制链接", type: "button", disabled: false },
        { text: "取消传输", type: "button", disabled: false },
      ]),
    "Active UI buttons are missing or not keyboard-operable buttons.",
  );
  assert(
    activeView.viewport.scrollWidth <= activeView.viewport.width,
    `Active UI overflows horizontally: ${JSON.stringify(activeView.viewport)}.`,
  );
  assert(
    activeView.viewport.scrollHeight <= activeView.viewport.height,
    `Active UI overflows vertically: ${JSON.stringify(activeView.viewport)}.`,
  );
  await captureScreenshot(pageSession, "transfer-active.png");

  const terminalStates = [
    { status: "cancelled", text: "传输已取消" },
    { status: "completed", text: "已发送到手机" },
    {
      status: "active",
      expiresAt: Date.now() - 1_000,
      text: "链接已失效",
    },
  ];
  for (const state of terminalStates) {
    const nextTransfer = {
      ...transfer,
      status: state.status,
      expiresAt: state.expiresAt ?? transfer.expiresAt,
    };
    await evaluate(workerSession, storageExpression(nextTransfer));
    const terminalView = await waitForView(
      pageSession,
      (view) =>
        view.text.includes(state.text) &&
        view.qrCount === 0 &&
        view.buttons.length === 0,
      `${state.text} terminal UI`,
    );
    assert(
      terminalView.text.includes("手机和电脑必须连接同一局域网"),
      `${state.text} UI lost the LAN reminder.`,
    );
    assert(
      terminalView.viewport.scrollWidth <= terminalView.viewport.width &&
        terminalView.viewport.scrollHeight <= terminalView.viewport.height,
      `${state.text} UI overflows: ${JSON.stringify(terminalView.viewport)}.`,
    );
    if (state.status === "completed") {
      await captureScreenshot(pageSession, "transfer-completed.png");
    }
  }

  process.stdout.write(
    `Transfer window: focused popup requested at 420x600, reported as ${windowDetails.width}x${windowDetails.height}\n`,
  );
  process.stdout.write(
    "Transfer UI: filename, size, QR, countdown, copy/cancel buttons, and LAN reminder\n",
  );
  process.stdout.write(
    "Terminal UI: cancelled, completed, and expired states\n",
  );
  if (screenshotDirectory !== undefined) {
    process.stdout.write(`Screenshots: ${screenshotDirectory}\n`);
  }
} finally {
  pageSession?.close();
  if (Number.isSafeInteger(transferWindowId)) {
    try {
      await evaluate(
        workerSession,
        `chrome.windows.remove(${transferWindowId})`,
      );
    } catch {
      // The browser cleanup in the parent script remains authoritative.
    }
  }
  workerSession.close();
}
