import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { McpSchema, McpServer } from "effect/unstable/ai";

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

const clickMethods = ["auto", "accessibility", "app_post", "sky_click", "global"] as const;

interface ComputerUseToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: {
    readonly destructiveHint: false;
    readonly openWorldHint: false;
    readonly idempotentHint?: true;
    readonly readOnlyHint?: true;
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
export const COMPUTER_USE_TOOLS: ReadonlyArray<ComputerUseToolSpec> = [
  {
    name: "click",
    description:
      "Click an element by index or pixel coordinates from screenshot. This tool is part of plugin `Computer Use`.",
    annotations: actionAnnotations,
    inputSchema: objectSchema(
      {
        app: stringProperty("App name or bundle identifier"),
        element_index: stringProperty("Element index to click"),
        x: numberProperty("X coordinate in screenshot pixel coordinates"),
        y: numberProperty("Y coordinate in screenshot pixel coordinates"),
        click_count: integerProperty("Number of clicks. Defaults to 1"),
        mouse_button: stringProperty("Mouse button to click. Defaults to left.", [
          "left",
          "right",
          "middle",
        ]),
        click_method: stringProperty(
          "Click implementation: auto (default), accessibility, app_post, sky_click, or global. Accessibility requires element_index. app_post sends a public event directly to the target app. sky_click uses the macOS SkyLight background window path. Global may move the system pointer and requires explicit user enablement in Cozea.",
          clickMethods,
        ),
      },
      ["app"],
    ),
  },
  {
    name: "drag",
    description:
      "Drag from one point to another using pixel coordinates. This tool is part of plugin `Computer Use`.",
    annotations: actionAnnotations,
    inputSchema: objectSchema(
      {
        app: stringProperty("App name or bundle identifier"),
        from_x: numberProperty("Start X coordinate"),
        from_y: numberProperty("Start Y coordinate"),
        to_x: numberProperty("End X coordinate"),
        to_y: numberProperty("End Y coordinate"),
      },
      ["app", "from_x", "from_y", "to_x", "to_y"],
    ),
  },
  {
    name: "get_app_state",
    description:
      "Start an app use session if needed, then get the state of the app's key window and return a screenshot and accessibility tree. This must be called once per assistant turn before interacting with the app. This tool is part of plugin `Computer Use`.",
    annotations: readAnnotations,
    inputSchema: objectSchema(
      {
        app: stringProperty("App name or bundle identifier"),
        text_limit: textLimitProperty(
          "Maximum text characters to return. Use \"max\" for full text. Defaults to 500.",
        ),
        max_tree_nodes: positiveIntegerProperty(
          "Maximum accessibility tree nodes to render. Defaults to 1200.",
        ),
        max_tree_depth: positiveIntegerProperty(
          "Maximum accessibility tree depth to render. Defaults to 64.",
        ),
      },
      ["app"],
    ),
  },
  {
    name: "list_apps",
    description:
      "List the apps on this computer. Returns the set of apps that are currently running, as well as any that have been used in the last 14 days, including details on usage frequency. This tool is part of plugin `Computer Use`.",
    annotations: readAnnotations,
    inputSchema: objectSchema({}),
  },
  {
    name: "perform_secondary_action",
    description:
      "Invoke a secondary accessibility action exposed by an element. This tool is part of plugin `Computer Use`.",
    annotations: actionAnnotations,
    inputSchema: objectSchema(
      {
        app: stringProperty("App name or bundle identifier"),
        element_index: stringProperty("Element identifier"),
        action: stringProperty("Secondary accessibility action name"),
      },
      ["app", "element_index", "action"],
    ),
  },
  {
    name: "press_key",
    description:
      "Press a key or key-combination on the keyboard, including modifier and navigation keys.\n  - This supports xdotool's `key` syntax.\n  - Examples: \"a\", \"Return\", \"Tab\", \"super+c\", \"Up\", \"KP_0\" (for the numpad 0 key). This tool is part of plugin `Computer Use`.",
    annotations: actionAnnotations,
    inputSchema: objectSchema(
      {
        app: stringProperty("App name or bundle identifier"),
        key: stringProperty("Key or key combination to press"),
      },
      ["app", "key"],
    ),
  },
  {
    name: "scroll",
    description:
      "Scroll an element in a direction by a number of pages. This tool is part of plugin `Computer Use`.",
    annotations: actionAnnotations,
    inputSchema: objectSchema(
      {
        app: stringProperty("App name or bundle identifier"),
        direction: stringProperty("Scroll direction: up, down, left, or right"),
        element_index: stringProperty("Element identifier"),
        pages: numberProperty(
          "Number of pages to scroll. Fractional values are supported. Defaults to 1",
        ),
      },
      ["app", "element_index", "direction"],
    ),
  },
  {
    name: "set_value",
    description:
      "Set the value of a settable accessibility element. This tool is part of plugin `Computer Use`.",
    annotations: actionAnnotations,
    inputSchema: objectSchema(
      {
        app: stringProperty("App name or bundle identifier"),
        element_index: stringProperty("Element identifier"),
        value: stringProperty("Value to assign"),
      },
      ["app", "element_index", "value"],
    ),
  },
  {
    name: "type_text",
    description:
      "Type literal text using keyboard input. This tool is part of plugin `Computer Use`.",
    annotations: actionAnnotations,
    inputSchema: objectSchema(
      {
        app: stringProperty("App name or bundle identifier"),
        text: stringProperty("Literal text to type"),
      },
      ["app", "text"],
    ),
  },
];

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
    content: content.length > 0 ? content : [{ type: "text", text: "Computer Use returned no content." }],
  });
};

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
            if (!invocation.capabilities.has("computerUse")) {
              return Effect.succeed(
                backendFailure("Computer Use is not authorized for this provider session."),
              );
            }
            return callComputerUseBackend(spec.name, payload, invocation).pipe(
              Effect.map(toMcpResult),
              Effect.catchAll((error) =>
                Effect.succeed(backendFailure(error.message || "Computer Use failed.")),
              ),
            );
          }),
      });
    }
  },
);

export const ComputerUseToolkitRegistrationLive = Effect.gen(function* () {
  yield* registerComputerUseTools();
}).pipe(Effect.scoped);
