import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { McpSchema, McpServer } from "effect/unstable/ai";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { forkParked } from "../../serverActivation.ts";
import * as McpInvocationContext from "../McpInvocationContext.ts";

const COMPUTER_USE_ENDPOINT = process.env.COZEA_COMPUTER_USE_ENDPOINT?.trim() ?? "";
const COMPUTER_USE_TOKEN = process.env.COZEA_COMPUTER_USE_TOKEN?.trim() ?? "";
const COMPUTER_USE_ENABLED = process.env.COZEA_COMPUTER_USE_ENABLED?.trim() === "1";
const DISABLED_TOOLS = new Set(
  (process.env.COZEA_COMPUTER_USE_DISABLED_TOOLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
// Track accepted provider turns, not Computer Use calls. Scheduled tasks that
// are explicitly denied CU still need authoritative terminal policy cleanup.
const ACTIVE_PROVIDER_TURN_THREADS = new Set<string>();

const clickMethods = ["auto", "accessibility", "app_post", "sky_click", "global"] as const;

interface ComputerUseToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: {
    readonly destructiveHint: boolean;
    readonly openWorldHint: boolean;
    readonly idempotentHint?: boolean;
    readonly readOnlyHint?: boolean;
  };
}

const stringProperty = (description: string, enumValues?: ReadonlyArray<string>) => ({
  type: "string",
  description,
  ...(enumValues ? { enum: [...enumValues] } : {}),
});
const numberProperty = (description: string) => ({ type: "number", description });
const integerProperty = (description: string) => ({ type: "integer", description });
const positiveIntegerProperty = (description: string) => ({
  type: "integer",
  minimum: 1,
  description,
});
const textLimitProperty = (description: string) => ({
  anyOf: [
    { type: "integer", minimum: 1 },
    { type: "string", enum: ["max"] },
  ],
  description,
});
const objectSchema = (
  properties: Record<string, unknown>,
  required: ReadonlyArray<string> = [],
) => ({
  type: "object",
  properties,
  additionalProperties: false,
  ...(required.length > 0 ? { required: [...required] } : {}),
});
const actionAnnotations = {
  destructiveHint: false,
  openWorldHint: false,
} as const;
const readAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;

/**
 * Tool names, descriptions, annotations and input schemas intentionally mirror
 * open-computer-use v0.3.3 (41c5294c). Cozea owns transport/policy only; the
 * execution engine remains OpenComputerUseKit / the upstream platform runtime.
 */
export const COMPUTER_USE_TOOLS: ReadonlyArray<ComputerUseToolSpec> = [{"name":"list_apps","description":"List currently running macOS applications with PIDs. Does not launch apps or include a recent-app catalogue.","annotations":{"readOnlyHint":true,"idempotentHint":true,"destructiveHint":false,"openWorldHint":false},"inputSchema":{"type":"object","properties":{},"required":[],"additionalProperties":false}},{"name":"get_app_state","description":"Explicitly observe a running, visible target window. Returns snapshot_id and the requested tree/screenshot. Call before the first action in each turn and after navigation, dialogs or reflow. Does not activate, launch or unminimize apps.","annotations":{"readOnlyHint":true,"idempotentHint":true,"destructiveHint":false,"openWorldHint":false},"inputSchema":{"type":"object","properties":{"app":{"type":"string","description":"Running application name, bundle identifier, or PID returned by list_apps.","minLength":1,"maxLength":512},"include_text":{"type":"boolean","default":true},"include_screenshot":{"type":"boolean","default":true},"text_limit":{"anyOf":[{"type":"integer","description":"Text character budget per element.","minimum":1,"maximum":100000},{"type":"string","enum":["max"]}],"default":500},"max_tree_nodes":{"type":"integer","description":"Tree node budget.","minimum":1,"maximum":5000,"default":1200},"max_tree_depth":{"type":"integer","description":"Tree depth budget.","minimum":1,"maximum":128,"default":64}},"required":["app"],"additionalProperties":false}},{"name":"click","description":"Move the visible Cozea cursor to the target, then click. Specify either element_index or both x and y. Coordinates belong to the returned screenshot, not global display coordinates. Returns a compact acknowledgement only, never a fresh screenshot/tree. Call get_app_state when the next target depends on changed UI. Never retry automatically after DELIVERY_UNKNOWN.","annotations":{"readOnlyHint":false,"idempotentHint":false,"destructiveHint":true,"openWorldHint":true},"inputSchema":{"type":"object","properties":{"app":{"type":"string","description":"Running application name, bundle identifier, or PID returned by list_apps.","minLength":1,"maxLength":512},"snapshot_id":{"type":"string","description":"snapshot_id from get_app_state. Omit to use this session/app's latest observation.","maxLength":128},"element_index":{"anyOf":[{"type":"string","description":"Element index from the observed accessibility tree.","pattern":"^\\d+$"},{"type":"integer","description":"Element index.","minimum":0,"maximum":1000000}]},"x":{"type":"number","description":"Screenshot pixel X.","minimum":0},"y":{"type":"number","description":"Screenshot pixel Y.","minimum":0},"click_count":{"type":"integer","description":"Click count.","minimum":1,"maximum":3,"default":1},"mouse_button":{"type":"string","description":"Mouse button.","enum":["left","right","middle"],"default":"left"},"click_method":{"type":"string","description":"auto selects semantic AX then targeted SkyLight/PID input. sky_click supports one or two left clicks. global requires explicit user permission and a foreground target; it may move the real pointer.","enum":["auto","accessibility","app_post","sky_click","global"],"default":"auto"}},"required":["app"],"additionalProperties":false,"oneOf":[{"required":["element_index"],"not":{"anyOf":[{"required":["x"]},{"required":["y"]}]}},{"required":["x","y"],"not":{"required":["element_index"]}}]}},{"name":"perform_secondary_action","description":"Move the visible cursor, then invoke an action exposed by an indexed accessibility element. Returns a compact acknowledgement only, never a fresh screenshot/tree. Call get_app_state when the next target depends on changed UI. Never retry automatically after DELIVERY_UNKNOWN.","annotations":{"readOnlyHint":false,"idempotentHint":false,"destructiveHint":true,"openWorldHint":true},"inputSchema":{"type":"object","properties":{"app":{"type":"string","description":"Running application name, bundle identifier, or PID returned by list_apps.","minLength":1,"maxLength":512},"snapshot_id":{"type":"string","description":"snapshot_id from get_app_state. Omit to use this session/app's latest observation.","maxLength":128},"element_index":{"anyOf":[{"type":"string","description":"Element index from the observed accessibility tree.","pattern":"^\\d+$"},{"type":"integer","description":"Element index.","minimum":0,"maximum":1000000}]},"action":{"type":"string","description":"Exposed secondary action.","minLength":1,"maxLength":256}},"required":["app","element_index","action"],"additionalProperties":false}},{"name":"scroll","description":"Move the visible cursor to the indexed scroll region, then scroll it. Observe again before reusing screenshot coordinates. Returns a compact acknowledgement only, never a fresh screenshot/tree. Call get_app_state when the next target depends on changed UI. Never retry automatically after DELIVERY_UNKNOWN.","annotations":{"readOnlyHint":false,"idempotentHint":false,"destructiveHint":true,"openWorldHint":true},"inputSchema":{"type":"object","properties":{"app":{"type":"string","description":"Running application name, bundle identifier, or PID returned by list_apps.","minLength":1,"maxLength":512},"snapshot_id":{"type":"string","description":"snapshot_id from get_app_state. Omit to use this session/app's latest observation.","maxLength":128},"element_index":{"anyOf":[{"type":"string","description":"Element index from the observed accessibility tree.","pattern":"^\\d+$"},{"type":"integer","description":"Element index.","minimum":0,"maximum":1000000}]},"direction":{"type":"string","description":"Direction.","enum":["up","down","left","right"]},"pages":{"type":"number","description":"Pages to scroll, including fractional values.","exclusiveMinimum":0,"maximum":20,"default":1}},"required":["app","element_index","direction"],"additionalProperties":false}},{"name":"drag","description":"Drag along the visible cursor path between two points from the same screenshot. Returns a compact acknowledgement only, never a fresh screenshot/tree. Call get_app_state when the next target depends on changed UI. Never retry automatically after DELIVERY_UNKNOWN.","annotations":{"readOnlyHint":false,"idempotentHint":false,"destructiveHint":true,"openWorldHint":true},"inputSchema":{"type":"object","properties":{"app":{"type":"string","description":"Running application name, bundle identifier, or PID returned by list_apps.","minLength":1,"maxLength":512},"snapshot_id":{"type":"string","description":"snapshot_id from get_app_state. Omit to use this session/app's latest observation.","maxLength":128},"from_x":{"type":"number","description":"Screenshot pixel coordinate.","minimum":0},"from_y":{"type":"number","description":"Screenshot pixel coordinate.","minimum":0},"to_x":{"type":"number","description":"Screenshot pixel coordinate.","minimum":0},"to_y":{"type":"number","description":"Screenshot pixel coordinate.","minimum":0}},"required":["app","from_x","from_y","to_x","to_y"],"additionalProperties":false}},{"name":"type_text","description":"Type at the current caret/selection of the observed window's focused editable control. Click that control first. This does not replace the full document value. Returns a compact acknowledgement only, never a fresh screenshot/tree. Call get_app_state when the next target depends on changed UI. Never retry automatically after DELIVERY_UNKNOWN.","annotations":{"readOnlyHint":false,"idempotentHint":false,"destructiveHint":true,"openWorldHint":true},"inputSchema":{"type":"object","properties":{"app":{"type":"string","description":"Running application name, bundle identifier, or PID returned by list_apps.","minLength":1,"maxLength":512},"snapshot_id":{"type":"string","description":"snapshot_id from get_app_state. Omit to use this session/app's latest observation.","maxLength":128},"text":{"type":"string","description":"Literal text.","maxLength":65536}},"required":["app","text"],"additionalProperties":false}},{"name":"press_key","description":"Press a key or shortcut in the observed focused window, such as Return, Tab, super+c or Up. Returns a compact acknowledgement only, never a fresh screenshot/tree. Call get_app_state when the next target depends on changed UI. Never retry automatically after DELIVERY_UNKNOWN.","annotations":{"readOnlyHint":false,"idempotentHint":false,"destructiveHint":true,"openWorldHint":true},"inputSchema":{"type":"object","properties":{"app":{"type":"string","description":"Running application name, bundle identifier, or PID returned by list_apps.","minLength":1,"maxLength":512},"snapshot_id":{"type":"string","description":"snapshot_id from get_app_state. Omit to use this session/app's latest observation.","maxLength":128},"key":{"type":"string","description":"Key combination.","minLength":1,"maxLength":256}},"required":["app","key"],"additionalProperties":false}},{"name":"set_value","description":"Move the visible cursor to an indexed, settable AXValue control, then replace its value. Never falls back to typing or clipboard. Returns a compact acknowledgement only, never a fresh screenshot/tree. Call get_app_state when the next target depends on changed UI. Never retry automatically after DELIVERY_UNKNOWN.","annotations":{"readOnlyHint":false,"idempotentHint":false,"destructiveHint":true,"openWorldHint":true},"inputSchema":{"type":"object","properties":{"app":{"type":"string","description":"Running application name, bundle identifier, or PID returned by list_apps.","minLength":1,"maxLength":512},"snapshot_id":{"type":"string","description":"snapshot_id from get_app_state. Omit to use this session/app's latest observation.","maxLength":128},"element_index":{"anyOf":[{"type":"string","description":"Element index from the observed accessibility tree.","pattern":"^\\d+$"},{"type":"integer","description":"Element index.","minimum":0,"maximum":1000000}]},"value":{"type":"string","description":"Replacement value.","maxLength":65536}},"required":["app","element_index","value"],"additionalProperties":false}}];

interface BackendContentItem {
  readonly type: "text" | "image";
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}
interface BackendToolResult {
  readonly content?: ReadonlyArray<BackendContentItem>;
  readonly isError?: boolean;
}

const backendFailure = (message: string) =>
  new McpSchema.CallToolResult({
    isError: true,
    content: [{ type: "text", text: message }],
  });

const toMcpResult = (result: BackendToolResult): McpSchema.CallToolResult => {
  const content = (result.content ?? []).flatMap((item) => {
    if (item.type === "text" && typeof item.text === "string") {
      return [{ type: "text" as const, text: item.text }];
    }
    if (
      item.type === "image" &&
      typeof item.data === "string" &&
      typeof item.mimeType === "string"
    ) {
      return [
        {
          type: "image" as const,
          data: new Uint8Array(Buffer.from(item.data, "base64")),
          mimeType: item.mimeType,
        },
      ];
    }
    return [];
  });
  return new McpSchema.CallToolResult({
    isError: result.isError === true,
    content:
      content.length > 0
        ? content
        : [{ type: "text", text: "Computer Use returned no content." }],
  });
};

export const isComputerUseTurnTerminalSession = (session: {
  readonly status: string;
  readonly activeTurnId: unknown;
}): boolean =>
  session.activeTurnId === null &&
  (session.status === "ready" ||
    session.status === "interrupted" ||
    session.status === "error" ||
    session.status === "stopped");

const callComputerUseBackend = (
  tool: string,
  arguments_: unknown,
  invocation: McpInvocationContext.McpInvocationScope,
) =>
  Effect.tryPromise({
    try: async () => {
      if (!COMPUTER_USE_ENABLED || !COMPUTER_USE_ENDPOINT || !COMPUTER_USE_TOKEN) {
        throw new Error("Computer Use is disabled or unavailable in this Cozea instance.");
      }
      if (DISABLED_TOOLS.has(tool)) {
        throw new Error(`Computer Use capability '${tool}' is disabled in Cozea Settings.`);
      }
      const response = await fetch(`${COMPUTER_USE_ENDPOINT.replace(/\/$/, "")}/v1/call`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${COMPUTER_USE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          environmentId: invocation.environmentId,
          threadId: invocation.threadId,
          providerSessionId: invocation.providerSessionId,
          providerInstanceId: invocation.providerInstanceId,
          tool,
          arguments: arguments_ ?? {},
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const raw = await response.text();
      let payload: BackendToolResult | undefined;
      try {
        payload = raw ? (JSON.parse(raw) as BackendToolResult) : undefined;
      } catch {
        // handled below with status/body diagnostic
      }
      if (!response.ok) {
        const detail = payload?.content?.find((item) => item.type === "text")?.text ?? raw;
        throw new Error(detail || `Computer Use backend returned HTTP ${response.status}.`);
      }
      if (!payload) {
        throw new Error("Computer Use backend returned an invalid response.");
      }
      return payload;
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });

const notifyComputerUseTurnEnded = (threadId: string) =>
  Effect.tryPromise({
    try: async () => {
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
        throw new Error(detail || `Computer Use turn-end backend returned HTTP ${response.status}.`);
      }
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Computer Use turn-end notification failed", {
        threadId,
        error: Cause.pretty(cause),
      }),
    ),
  );

export const ComputerUseTurnLifecycleLive = Layer.effectDiscard(
  Effect.gen(function* () {
    if (!COMPUTER_USE_ENABLED || !COMPUTER_USE_ENDPOINT || !COMPUTER_USE_TOKEN) {
      return;
    }
    const orchestrationEngine = yield* OrchestrationEngineService;
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (event.type !== "thread.session-set") {
          return Effect.void;
        }
        const { threadId, session } = event.payload;
        const normalizedThreadId = String(threadId);
        if (session.activeTurnId != null) {
          ACTIVE_PROVIDER_TURN_THREADS.add(normalizedThreadId);
          return Effect.void;
        }
        if (
          !isComputerUseTurnTerminalSession(session) ||
          !ACTIVE_PROVIDER_TURN_THREADS.delete(normalizedThreadId)
        ) {
          return Effect.void;
        }
        // Only terminal sessions that follow an observed active provider turn
        // are forwarded. This excludes pre-turn ready states while still
        // covering scheduled threads that never invoked a Computer Use tool.
        return notifyComputerUseTurnEnded(normalizedThreadId);
      }),
    );
  }),
);

export const registerComputerUseTools = Effect.fn("McpHttpServer.registerComputerUseTools")(
  function* () {
    if (!COMPUTER_USE_ENABLED || !COMPUTER_USE_ENDPOINT || !COMPUTER_USE_TOKEN) {
      return;
    }
    const server = yield* McpServer.McpServer;
    for (const spec of COMPUTER_USE_TOOLS) {
      if (DISABLED_TOOLS.has(spec.name)) continue;
      yield* server.addTool({
        tool: new McpSchema.Tool({
          name: spec.name,
          description: spec.description,
          inputSchema: spec.inputSchema,
          annotations: spec.annotations,
        }),
        annotations: Context.empty(),
        handle: (payload) =>
          Effect.withFiber((fiber) => {
            const invocation = Context.getUnsafe(
              fiber.context,
              McpInvocationContext.McpInvocationContext,
            );
            return callComputerUseBackend(spec.name, payload, invocation).pipe(
              Effect.map(toMcpResult),
              Effect.catchCause((cause) => {
                const error = Cause.squash(cause);
                const message = error instanceof Error ? error.message : String(error);
                return Effect.succeed(backendFailure(message || "Computer Use failed."));
              }),
            );
          }),
      });
    }
  },
);
