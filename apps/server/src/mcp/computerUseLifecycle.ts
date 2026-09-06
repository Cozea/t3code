import type { OrchestrationEvent, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";

const COMPUTER_USE_ENDPOINT = process.env.COZEA_COMPUTER_USE_ENDPOINT?.trim() ?? "";
const COMPUTER_USE_TOKEN = process.env.COZEA_COMPUTER_USE_TOKEN?.trim() ?? "";
const TURN_ENDED_STATUSES = new Set(["ready", "interrupted", "error", "stopped"]);

/**
 * ProviderRuntimeIngestion only emits thread.session-set after its lifecycle
 * guard accepts a provider transition. Listening to that domain event keeps
 * Computer Use cursor cleanup aligned with the canonical turn boundary while
 * ignoring stale turn.completed/turn.aborted events rejected by ingestion.
 */
export const shouldNotifyComputerUseTurnEnded = (event: OrchestrationEvent): boolean =>
  event.type === "thread.session-set" &&
  event.payload.session.activeTurnId === null &&
  TURN_ENDED_STATUSES.has(event.payload.session.status);

const notifyComputerUseTurnEnded = (threadId: ThreadId) =>
  Effect.tryPromise({
    try: async () => {
      if (!COMPUTER_USE_ENDPOINT || !COMPUTER_USE_TOKEN) return;
      const response = await fetch(
        `${COMPUTER_USE_ENDPOINT.replace(/\/$/, "")}/v1/turn-ended`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${COMPUTER_USE_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ threadId }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Computer Use turn-ended returned HTTP ${response.status}.`);
      }
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

export const startComputerUseTurnLifecycle = Effect.fn(
  "ComputerUseLifecycle.start",
)(function* () {
  if (!COMPUTER_USE_ENDPOINT || !COMPUTER_USE_TOKEN) return;

  const orchestrationEngine = yield* OrchestrationEngineService;
  yield* Effect.forkScoped(
    Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
      if (!shouldNotifyComputerUseTurnEnded(event)) return Effect.void;
      return notifyComputerUseTurnEnded(event.payload.threadId).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning("failed to forward Computer Use turn-ended notification", {
            threadId: event.payload.threadId,
            status: event.payload.session.status,
            error: error.message,
          }),
        ),
      );
    }),
  );
});
