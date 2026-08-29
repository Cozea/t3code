import * as NodeAssert from "node:assert/strict";
import { describe, it } from "@effect/vitest";

import {
  acpPreviewToolInstructionBlock,
  previewToolInstructions,
} from "./PreviewToolInstructions.ts";

describe("preview tool instructions", () => {
  it("routes generic development-server requests through the managed tool", () => {
    const instructions = previewToolInstructions(true);

    NodeAssert.match(instructions, /call `dev_server_ensure` before using any shell/);
    NodeAssert.match(instructions, /Omit `command` unless the user explicitly supplied/);
    NodeAssert.match(instructions, /first call `preview_status`/);
    NodeAssert.match(instructions, /call `preview_open`/);
  });

  it("omits every reference when the product MCP session is unavailable", () => {
    NodeAssert.equal(previewToolInstructions(false), "");
    NodeAssert.equal(acpPreviewToolInstructionBlock(false), "");
  });

  it("delimits the fallback instruction block for ACP providers", () => {
    const block = acpPreviewToolInstructionBlock(true);

    NodeAssert.match(block, /^<developer_instructions>/);
    NodeAssert.match(block, /dev_server_ensure/);
    NodeAssert.match(block, /<\/developer_instructions>$/);
  });
});
