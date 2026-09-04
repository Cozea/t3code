import * as NodeEvents from "node:events";
import { ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vitest";
import { bindCozeaHostUpdateControl } from "./cozeaHostUpdateControl.ts";

function setup() {
  const events = new NodeEvents.EventEmitter();
  const replies = new NodeEvents.EventEmitter();
  const threadIds = [ThreadId.make("thread")];
  const prepare = vi.fn(async () => threadIds);
  const clear = vi.fn(async () => undefined);
  let expire = () => {};
  const dispose = bindCozeaHostUpdateControl(
    {
      on: (_, listener) => events.on("message", listener),
      off: (_, listener) => events.off("message", listener),
      send: (message) => replies.emit("reply", message),
    },
    {
      prepare,
      clear,
      scheduleExpiry: (callback) => {
        expire = callback;
        return () => {};
      },
    },
  );
  function request(action: string, requestId = "update-1") {
    const reply = new Promise<unknown>((resolve) => replies.once("reply", resolve));
    events.emit("message", { type: "cozea:host-update", requestId, action });
    return reply;
  }
  return { request, prepare, clear, dispose, threadIds, expire: () => expire() };
}
it("acknowledges persisted markers, coalesces prepare, and cancels only the matching update", async () => {
  const h = setup();
  try {
    expect(await h.request("prepare")).toMatchObject({ success: true });
    expect(await h.request("prepare")).toMatchObject({ success: true });
    expect(h.prepare).toHaveBeenCalledOnce();
    expect(await h.request("prepare", "other")).toMatchObject({ success: false });
    await h.request("cancel", "other");
    expect(h.clear).not.toHaveBeenCalled();
    await h.request("cancel");
    expect(h.clear).toHaveBeenCalledWith(h.threadIds);
  } finally {
    h.dispose();
  }
});
it("reports persistence failure without acknowledging update readiness", async () => {
  const h = setup();
  h.prepare.mockRejectedValueOnce(new Error("private database details"));
  try {
    const reply = await h.request("prepare");
    expect(reply).toMatchObject({ success: false });
    expect(JSON.stringify(reply)).not.toContain("private database");
  } finally {
    h.dispose();
  }
});
it("expires markers when the host never shuts down", async () => {
  const h = setup();
  try {
    await h.request("prepare");
    h.expire();
    await h.request("cancel");
    expect(h.clear).toHaveBeenCalledWith(h.threadIds);
  } finally {
    h.dispose();
  }
});
