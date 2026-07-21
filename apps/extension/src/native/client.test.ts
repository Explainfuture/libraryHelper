import { afterEach, describe, expect, it, vi } from "vitest";

import type { NativeRequest } from "../protocol/messages";
import { NativeClient } from "./client";
import { NativeClientError, NativeHostError } from "./errors";

type MessageListener = (message: unknown) => void;
type DisconnectListener = () => void;

class FakeEvent<Listener extends (...arguments_: never[]) => void> {
  readonly listeners = new Set<Listener>();

  addListener(listener: Listener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: Listener): void {
    this.listeners.delete(listener);
  }
}

class FakePort {
  readonly onMessage = new FakeEvent<MessageListener>();
  readonly onDisconnect = new FakeEvent<DisconnectListener>();
  readonly messages: NativeRequest[] = [];
  disconnected = false;

  postMessage(message: NativeRequest): void {
    this.messages.push(message);
  }

  disconnect(): void {
    this.disconnected = true;
  }

  emitMessage(message: unknown): void {
    for (const listener of this.onMessage.listeners) {
      listener(message);
    }
  }

  emitDisconnect(): void {
    for (const listener of this.onDisconnect.listeners) {
      listener();
    }
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("NativeClient", () => {
  it("reuses one port and correlates responses by request ID", async () => {
    const port = new FakePort();
    const client = new NativeClient({ connect: () => port });

    const first = client.createTransfer("C:/Downloads/one.epub", 1);
    const second = client.createTransfer("C:/Downloads/two.epub", 2);
    expect(port.messages).toHaveLength(2);

    const [firstRequest, secondRequest] = port.messages;
    if (firstRequest === undefined || secondRequest === undefined) {
      throw new Error("requests were not posted");
    }
    port.emitMessage(createdResponse(secondRequest.requestId, "transfer-2"));
    port.emitMessage(createdResponse(firstRequest.requestId, "transfer-1"));

    await expect(first).resolves.toMatchObject({
      payload: { transferId: "transfer-1" },
    });
    await expect(second).resolves.toMatchObject({
      payload: { transferId: "transfer-2" },
    });
    expect(port.disconnected).toBe(false);
    client.dispose();
  });

  it("rejects a request after its timeout", async () => {
    vi.useFakeTimers();
    const client = new NativeClient({
      connect: () => new FakePort(),
      requestTimeoutMs: 250,
    });

    const request = client.createTransfer("C:/Downloads/book.epub", 4);
    const assertion = expect(request).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
    client.dispose();
  });

  it("surfaces structured errors returned by the host", async () => {
    const port = new FakePort();
    const client = new NativeClient({ connect: () => port });
    const request = client.createTransfer("C:/Downloads/bad.epub", 5);
    const posted = port.messages[0];
    if (posted === undefined) {
      throw new Error("request was not posted");
    }

    port.emitMessage({
      type: "ERROR",
      requestId: posted.requestId,
      error: { code: "INVALID_EPUB", message: "not an EPUB" },
    });

    await expect(request).rejects.toEqual(
      new NativeHostError("INVALID_EPUB", "not an EPUB"),
    );
    client.dispose();
  });

  it("rejects a mismatched response type", async () => {
    const port = new FakePort();
    const client = new NativeClient({ connect: () => port });
    const request = client.createTransfer("C:/Downloads/book.epub", 6);
    const posted = port.messages[0];
    if (posted === undefined) {
      throw new Error("request was not posted");
    }

    port.emitMessage({
      type: "TRANSFER_CANCELLED",
      requestId: posted.requestId,
      payload: { transferId: "transfer-1" },
    });

    await expect(request).rejects.toMatchObject({ code: "PROTOCOL_ERROR" });
    client.dispose();
  });

  it("rejects in-flight work and reconnects with exponential backoff", async () => {
    vi.useFakeTimers();
    const ports = [new FakePort(), new FakePort(), new FakePort()];
    const connect = vi
      .fn<() => FakePort>()
      .mockReturnValueOnce(ports[0] as FakePort)
      .mockReturnValueOnce(ports[1] as FakePort)
      .mockReturnValueOnce(ports[2] as FakePort);
    const client = new NativeClient({
      connect,
      initialReconnectDelayMs: 100,
      maxReconnectDelayMs: 400,
    });
    client.start();

    const request = client.createTransfer("C:/Downloads/book.epub", 7);
    ports[0]?.emitDisconnect();
    await expect(request).rejects.toMatchObject({ code: "DISCONNECTED" });
    expect(connect).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(connect).toHaveBeenCalledTimes(2);
    ports[1]?.emitDisconnect();
    await vi.advanceTimersByTimeAsync(199);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(3);
    client.dispose();
  });

  it("resets reconnect delay after a valid message", async () => {
    vi.useFakeTimers();
    const first = new FakePort();
    const second = new FakePort();
    const third = new FakePort();
    const connect = vi
      .fn<() => FakePort>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(third);
    const client = new NativeClient({
      connect,
      initialReconnectDelayMs: 100,
      maxReconnectDelayMs: 400,
    });
    client.start();
    first.emitDisconnect();
    await vi.advanceTimersByTimeAsync(100);

    const request = client.createTransfer("C:/Downloads/book.epub", 8);
    const posted = second.messages[0];
    if (posted === undefined) {
      throw new Error("request was not posted");
    }
    second.emitMessage(createdResponse(posted.requestId, "transfer-8"));
    await request;
    second.emitDisconnect();

    await vi.advanceTimersByTimeAsync(99);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(3);
    client.dispose();
  });

  it("publishes completion events independently of pending requests", () => {
    const port = new FakePort();
    const client = new NativeClient({ connect: () => port });
    const listener = vi.fn();
    client.onTransferCompleted(listener);
    client.start();

    port.emitMessage({
      type: "TRANSFER_COMPLETED",
      requestId: "transfer-9",
      payload: { transferId: "transfer-9" },
    });

    expect(listener).toHaveBeenCalledWith({
      type: "TRANSFER_COMPLETED",
      requestId: "transfer-9",
      payload: { transferId: "transfer-9" },
    });
    client.dispose();
  });

  it("does not reconnect after disposal", async () => {
    vi.useFakeTimers();
    const port = new FakePort();
    const connect = vi.fn(() => port);
    const client = new NativeClient({
      connect,
      initialReconnectDelayMs: 50,
    });
    client.start();
    port.emitDisconnect();
    client.dispose();

    await vi.advanceTimersByTimeAsync(100);
    expect(connect).toHaveBeenCalledTimes(1);
    await expect(
      client.createTransfer("C:/Downloads/book.epub", 10),
    ).rejects.toEqual(expect.any(NativeClientError));
  });
});

function createdResponse(requestId: string, transferId: string): unknown {
  return {
    type: "TRANSFER_CREATED",
    requestId,
    payload: {
      transferId,
      url: "http://192.168.1.10:18321/t/token",
      filename: "book.epub",
      size: 123,
      expiresAt: 1_780_000_000_000,
    },
  };
}
