import { expect, it } from "@effect/vitest";

import { COMPUTER_USE_TOOLS } from "./computerUse.ts";

const EXPECTED_TOOLS = [
  "click",
  "drag",
  "get_app_state",
  "list_apps",
  "perform_secondary_action",
  "press_key",
  "scroll",
  "set_value",
  "type_text",
] as const;

it("mirrors the pinned open-computer-use v0.3.3 tool surface", () => {
  expect(COMPUTER_USE_TOOLS.map((tool) => tool.name)).toEqual(EXPECTED_TOOLS);
  expect(new Set(COMPUTER_USE_TOOLS.map((tool) => tool.name)).size).toBe(9);

  for (const tool of COMPUTER_USE_TOOLS) {
    expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(40);
    expect(tool.inputSchema.type, `${tool.name} schema type`).toBe("object");
    expect(tool.inputSchema.additionalProperties, `${tool.name} strict schema`).toBe(false);
  }
});

it("keeps state discovery read-only and actions non-open-world", () => {
  const byName = new Map(COMPUTER_USE_TOOLS.map((tool) => [tool.name, tool]));
  expect(byName.get("list_apps")?.annotations.readOnlyHint).toBe(true);
  expect(byName.get("get_app_state")?.annotations.readOnlyHint).toBe(true);

  for (const name of EXPECTED_TOOLS) {
    expect(byName.get(name)?.annotations.openWorldHint).toBe(false);
    expect(byName.get(name)?.annotations.destructiveHint).toBe(false);
  }
});

it("keeps global pointer movement behind an explicit click method", () => {
  const click = COMPUTER_USE_TOOLS.find((tool) => tool.name === "click");
  const properties = click?.inputSchema.properties as Record<string, any> | undefined;
  expect(properties?.click_method?.enum).toEqual([
    "auto",
    "accessibility",
    "app_post",
    "sky_click",
    "global",
  ]);
});
