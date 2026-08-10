import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import process from "node:process";

const [
  portArgument,
  extensionId,
  screenshotDirectoryArgument,
  epubFixtureArgument,
] = process.argv.slice(2);
const port = Number.parseInt(portArgument ?? "", 10);
const screenshotDirectory = screenshotDirectoryArgument
  ? resolve(screenshotDirectoryArgument)
  : undefined;
const epubFixture = epubFixtureArgument
  ? resolve(epubFixtureArgument)
  : undefined;

if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
  throw new TypeError("A valid Chrome DevTools port is required.");
}
if (!/^[a-p]{32}$/.test(extensionId ?? "")) {
  throw new TypeError("A valid unpacked extension ID is required.");
}
if (epubFixture !== undefined && !existsSync(epubFixture)) {
  throw new TypeError(`The EPUB fixture does not exist: ${epubFixture}`);
}

const devToolsBaseURL = `http://127.0.0.1:${port}`;
const popupURL = `chrome-extension://${extensionId}/popup.html`;
const transferURL = `chrome-extension://${extensionId}/transfer.html`;

class CdpSession {
  #nextId = 1;
  #pending = new Map();
  #socket;

  static async connect(webSocketURL) {
    const socket = new WebSocket(webSocketURL);
    await new Promise((resolveConnection, rejectConnection) => {
      const timeout = setTimeout(() => {
        rejectConnection(new Error(`Timed out connecting to ${webSocketURL}`));
      }, 10_000);
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timeout);
          resolveConnection();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          rejectConnection(new Error(`Could not connect to ${webSocketURL}`));
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
  }

  send(method, parameters = {}) {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolveCommand, rejectCommand) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        rejectCommand(new Error(`CDP command timed out: ${method}`));
      }, 10_000);
      this.#pending.set(id, {
        method,
        resolve: resolveCommand,
        reject: rejectCommand,
        timeout,
      });
      this.#socket.send(JSON.stringify({ id, method, params: parameters }));
    });
  }

  close() {
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
      pending.reject(new Error(message.error.message));
      return;
    }
    pending.resolve(message.result);
  }
}

async function listTargets() {
  const response = await fetch(`${devToolsBaseURL}/json/list`);
  if (!response.ok) {
    throw new Error(`Could not list Chrome targets: HTTP ${response.status}`);
  }
  return response.json();
}

async function waitForPopup() {
  const deadline = Date.now() + 10_000;
  do {
    const target = (await listTargets()).find(
      (candidate) => candidate.type === "page" && candidate.url === popupURL,
    );
    if (target !== undefined) {
      return target;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for the BookBridge popup.");
}

async function waitForTransfer() {
  const deadline = Date.now() + 10_000;
  do {
    const target = (await listTargets()).find(
      (candidate) => candidate.type === "page" && candidate.url === transferURL,
    );
    if (target !== undefined) {
      return target;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for the BookBridge transfer window.");
}

async function waitForPage(url) {
  const deadline = Date.now() + 10_000;
  do {
    const target = (await listTargets()).find(
      (candidate) => candidate.type === "page" && candidate.url === url,
    );
    if (target !== undefined) {
      return target;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for page: ${url}`);
}

async function evaluate(session, expression) {
  const response = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails !== undefined) {
    throw new Error(response.exceptionDetails.text ?? "JavaScript exception");
  }
  return response.result?.value;
}

async function completeWebRTCTransfer(transferSession, shareURL) {
  const encodedShareURL = encodeURIComponent(shareURL);
  const response = await fetch(
    `${devToolsBaseURL}/json/new?${encodedShareURL}`,
    { method: "PUT" },
  );
  assert(response.ok, `Could not open receiver page: HTTP ${response.status}`);
  const receiverTarget = await waitForPage(shareURL);
  const receiverSession = await CdpSession.connect(
    receiverTarget.webSocketDebuggerUrl,
  );
  try {
    let senderText = "";
    let receiverText = "";
    const completionDeadline = Date.now() + 30_000;
    do {
      [senderText, receiverText] = await Promise.all([
        evaluate(transferSession, "document.body?.innerText ?? ''"),
        evaluate(receiverSession, "document.body?.innerText ?? ''"),
      ]);
      if (
        senderText.includes("已发送到手机") &&
        receiverText.includes("文件完整接收")
      ) {
        return;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    } while (Date.now() < completionDeadline);
    assert(
      senderText.includes("已发送到手机"),
      `Sender did not complete the WebRTC transfer: ${senderText}`,
    );
    assert(
      receiverText.includes("文件完整接收"),
      `Receiver did not complete the WebRTC transfer: ${receiverText}`,
    );
  } finally {
    receiverSession.close();
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const popupTarget = await waitForPopup();
const popupSession = await CdpSession.connect(popupTarget.webSocketDebuggerUrl);
try {
  await popupSession.send("Emulation.setDeviceMetricsOverride", {
    width: 360,
    height: 410,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const view = await evaluate(
    popupSession,
    `(() => ({
      title: document.title,
      text: document.body?.innerText ?? "",
      button: (() => {
        const element = document.querySelector("button.start-button");
        return element === null ? null : {
          text: element.textContent?.trim() ?? "",
          type: element.type,
          disabled: element.disabled,
        };
      })(),
      viewport: {
        width: innerWidth,
        height: innerHeight,
        scrollWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0),
        scrollHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
      },
    }))()`,
  );
  for (const text of [
    "纯浏览器版",
    "下载 EPUB，直接扫码",
    "打开传书窗口",
    "无本地助手",
  ]) {
    assert(view.text.includes(text), `Popup UI is missing: ${text}`);
  }
  assert(
    JSON.stringify(view.button) ===
      JSON.stringify({
        text: "打开传书窗口",
        type: "button",
        disabled: false,
      }),
    `Popup action is not accessible: ${JSON.stringify(view.button)}`,
  );
  assert(
    view.viewport.scrollWidth <= view.viewport.width &&
      view.viewport.scrollHeight <= view.viewport.height,
    `Popup UI overflows: ${JSON.stringify(view.viewport)}`,
  );

  if (screenshotDirectory !== undefined) {
    mkdirSync(screenshotDirectory, { recursive: true });
    await popupSession.send("Page.enable");
    const screenshot = await popupSession.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    writeFileSync(
      join(screenshotDirectory, "extension-popup.png"),
      Buffer.from(screenshot.data, "base64"),
    );
  }

  await evaluate(
    popupSession,
    `(() => {
      document.querySelector("button.start-button")?.click();
      return true;
    })()`,
  );
  const transferTarget = await waitForTransfer();
  const transferSession = await CdpSession.connect(
    transferTarget.webSocketDebuggerUrl,
  );
  try {
    await transferSession.send("Emulation.setDeviceMetricsOverride", {
      width: 440,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    let transferView;
    const transferDeadline = Date.now() + 10_000;
    do {
      transferView = await evaluate(
        transferSession,
        `(() => ({
          title: document.title,
          text: document.body?.innerText ?? "",
          picker: (() => {
            const element = document.querySelector('input[type="file"]');
            return element === null ? null : {
              accept: element.accept,
              type: element.type,
            };
          })(),
          url: location.href,
        }))()`,
      );
      if (transferView.text.includes("插件内点对点传书")) {
        break;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    } while (Date.now() < transferDeadline);
    for (const text of [
      "一次授权 · 自动传书",
      "下载完成，直接扫码",
      "自动读取目录",
    ]) {
      assert(
        transferView.text.includes(text),
        `Transfer UI is missing: ${text}`,
      );
    }
    assert(
      transferView.url === transferURL,
      `Transfer window is not extension-owned: ${transferView.url}`,
    );
    assert(
      transferView.picker?.type === "file" &&
        transferView.picker.accept.includes(".epub"),
      `Transfer file picker is not EPUB-scoped: ${JSON.stringify(transferView.picker)}`,
    );

    if (screenshotDirectory !== undefined) {
      mkdirSync(screenshotDirectory, { recursive: true });
      await transferSession.send("Page.enable");
      const screenshot = await transferSession.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      writeFileSync(
        join(screenshotDirectory, "extension-transfer.png"),
        Buffer.from(screenshot.data, "base64"),
      );
    }

    if (epubFixture !== undefined) {
      await transferSession.send("DOM.enable");
      const document = await transferSession.send("DOM.getDocument", {
        depth: 1,
      });
      const picker = await transferSession.send("DOM.querySelector", {
        nodeId: document.root.nodeId,
        selector: 'input[type="file"]',
      });
      assert(picker.nodeId > 0, "Transfer file input was not found.");
      await transferSession.send("DOM.setFileInputFiles", {
        files: [epubFixture],
        nodeId: picker.nodeId,
      });

      let shareURL = "";
      const pairingDeadline = Date.now() + 20_000;
      do {
        shareURL =
          (await evaluate(
            transferSession,
            `document.querySelector("[data-share-url]")?.dataset.shareUrl ?? ""`,
          )) ?? "";
        if (shareURL !== "") {
          break;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      } while (Date.now() < pairingDeadline);
      const pairingText = await evaluate(
        transferSession,
        "document.body?.innerText ?? ''",
      );
      assert(
        /^https?:\/\/[^#]+\/#\/receive\?peer=[^&]+&token=.+$/u.test(shareURL),
        `The extension did not create a receiver QR URL: ${shareURL}\n${pairingText}`,
      );

      await completeWebRTCTransfer(transferSession, shareURL);
      process.stdout.write(
        `WebRTC E2E: manual fallback transferred ${epubFixture} to the phone receiver page\n`,
      );

      const fixtureName = basename(epubFixture);
      const fixtureBytes = readFileSync(epubFixture);
      const seedResult = await evaluate(
        transferSession,
        `(async () => {
          const root = await navigator.storage.getDirectory();
          const directory = await root.getDirectoryHandle("automatic-books", { create: true });
          const fileHandle = await directory.getFileHandle(${JSON.stringify(fixtureName)}, { create: true });
          const writable = await fileHandle.createWritable();
          const binary = atob(${JSON.stringify(fixtureBytes.toString("base64"))});
          const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
          await writable.write(bytes);
          await writable.close();
          const database = await new Promise((resolveDatabase, rejectDatabase) => {
            const request = indexedDB.open("bookbridge-file-access", 1);
            request.onupgradeneeded = () => {
              if (!request.result.objectStoreNames.contains("directories")) {
                request.result.createObjectStore("directories", { keyPath: "id" });
              }
            };
            request.onsuccess = () => resolveDatabase(request.result);
            request.onerror = () => rejectDatabase(request.error);
          });
          await new Promise((resolveTransaction, rejectTransaction) => {
            const transaction = database.transaction("directories", "readwrite");
            transaction.objectStore("directories").put({
              id: "automatic-smoke-directory",
              addedAt: Date.now(),
              handle: directory,
            });
            transaction.oncomplete = resolveTransaction;
            transaction.onerror = () => rejectTransaction(transaction.error);
          });
          database.close();
          return { name: directory.name, size: bytes.byteLength };
        })()`,
      );
      assert(
        seedResult?.name === "automatic-books" &&
          seedResult.size === fixtureBytes.byteLength,
        `Could not seed an authorized directory handle: ${JSON.stringify(seedResult)}`,
      );

      const automaticURL = `${transferURL}?filename=${encodeURIComponent(fixtureName)}&size=${fixtureBytes.byteLength.toString()}`;
      await transferSession.send("Page.navigate", { url: automaticURL });
      let automaticShareURL = "";
      let automaticText = "";
      const automaticDeadline = Date.now() + 20_000;
      do {
        [automaticShareURL, automaticText] = await Promise.all([
          evaluate(
            transferSession,
            `document.querySelector("[data-share-url]")?.dataset.shareUrl ?? ""`,
          ),
          evaluate(transferSession, "document.body?.innerText ?? ''"),
        ]);
        if (
          automaticShareURL !== "" &&
          automaticText.includes("自动读取自 automatic-books")
        ) {
          break;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      } while (Date.now() < automaticDeadline);
      assert(
        automaticText.includes("自动读取自 automatic-books"),
        `Authorized directory was not used automatically: ${automaticText}`,
      );
      assert(
        /^https?:\/\/[^#]+\/#\/receive\?peer=[^&]+&token=.+$/u.test(
          automaticShareURL,
        ),
        `Automatic directory flow did not create a receiver URL: ${automaticShareURL}`,
      );
      await completeWebRTCTransfer(transferSession, automaticShareURL);
      process.stdout.write(
        "Directory E2E: stored read-only directory handle skipped the file picker and completed WebRTC transfer\n",
      );
    }
  } finally {
    transferSession.close();
  }
  process.stdout.write(
    "Popup UI: directory automation launcher; extension transfer UI: authorized folders, fallback picker, and QR flow\n",
  );
} finally {
  popupSession.close();
}
