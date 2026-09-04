import type { ThreadId } from "@t3tools/contracts";

interface HostControlPort {
  on(event: "message", listener: (message: unknown) => void): unknown;
  off(event: "message", listener: (message: unknown) => void): unknown;
  send(message: unknown): unknown;
}
interface ContinuationOperations {
  prepare(): Promise<ReadonlyArray<ThreadId>>;
  clear(threadIds: ReadonlyArray<ThreadId>): Promise<void>;
  scheduleExpiry(expire: () => void): () => void;
}

/** Parent-only IPC. It reuses the startup reconciler; no renderer sends Continue. */
export function bindCozeaHostUpdateControl(
  port: HostControlPort,
  operations: ContinuationOperations,
): () => void {
  let prepared: { requestId: string; threadIds: ReadonlyArray<ThreadId> } | null = null;
  let cancelExpiry: (() => void) | undefined;
  let queue = Promise.resolve();
  let closed = false;
  const clear = async () => {
    cancelExpiry?.();
    cancelExpiry = undefined;
    if (!prepared) return;
    await operations.clear(prepared.threadIds);
    prepared = null;
  };
  const listener = (message: unknown) => {
    if (
      !message ||
      typeof message !== "object" ||
      !("type" in message) ||
      message.type !== "cozea:host-update" ||
      !("requestId" in message) ||
      typeof message.requestId !== "string" ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(message.requestId) ||
      !("action" in message) ||
      (message.action !== "prepare" && message.action !== "cancel")
    )
      return;
    const { requestId, action } = message;
    queue = queue.then(async () => {
      if (closed) return;
      try {
        if (action === "cancel") {
          if (prepared?.requestId === requestId) await clear();
        } else if (prepared && prepared.requestId !== requestId) {
          throw new Error("Another update is being prepared.");
        } else if (!prepared) {
          prepared = { requestId, threadIds: await operations.prepare() };
          // A host that stays alive without installing must not leave opt-in
          // markers behind for an unrelated later crash or ordinary quit.
          cancelExpiry = operations.scheduleExpiry(() => {
            queue = queue.then(clear).catch(() => undefined);
          });
        }
        port.send({ type: "cozea:host-update-result", requestId, action, success: true });
      } catch {
        port.send({
          type: "cozea:host-update-result",
          requestId,
          action,
          success: false,
          error: "Could not prepare or cancel active chat continuation.",
        });
      }
    });
  };
  port.on("message", listener);
  return () => {
    closed = true;
    port.off("message", listener);
    cancelExpiry?.();
    // Successful shutdown intentionally leaves markers for the replacement.
  };
}
