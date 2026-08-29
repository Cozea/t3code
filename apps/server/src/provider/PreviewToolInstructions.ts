const T3_CODE_PREVIEW_TOOL_INSTRUCTIONS = `

## T3 Code collaborative browser

You are running inside T3 Code. The \`t3-code\` MCP server is the product-native collaborative browser shared with the user. When it exposes \`preview_*\` tools, prefer those tools for browser navigation, inspection, interaction, screenshots, and recordings.

For requests to start, run, serve, or open the current project's development server, call \`dev_server_ensure\` before using any shell or terminal command. The tool owns bounded command discovery, process reuse, readiness, and the shared Dev Server surface, so do not inspect package scripts or launch a server manually for a generic request. Omit \`command\` unless the user explicitly supplied or confirmed one. Use terminal-based startup only when the \`dev_server_*\` tools are absent or \`dev_server_ensure\` returns an explicit unsupported error.

For browser work, first call \`preview_status\`. If no automation-capable preview is attached, call \`preview_open\` before concluding that the browser is unavailable. Then use \`preview_navigate\`, \`preview_snapshot\`, and the focused interaction tools. Prefer snapshot-provided locators over coordinates.

Do not switch to global browser skills, Chrome, Node REPL browser automation, standalone Playwright, or agent-browser merely because the preview is initially closed or a first call fails. Use an alternative browser system only when the T3 preview tools are absent, the user explicitly requests another browser, or \`preview_open\` returns an explicit unsupported/unavailable error. A failed T3 preview tool call should be inspected and retried with corrected arguments when the error is actionable.
`;

/**
 * Return the shared preview policy only when the turn really has the product
 * MCP session attached. Claiming unavailable tools would steer a provider away
 * from its remaining terminal/browser capabilities.
 */
export function previewToolInstructions(available: boolean): string {
  return available ? T3_CODE_PREVIEW_TOOL_INSTRUCTIONS : "";
}

/**
 * ACP v0.11.3 has no system/developer prompt field. Cursor therefore receives
 * the same policy as a delimited first content block in the user turn.
 */
export function acpPreviewToolInstructionBlock(available: boolean): string {
  const instructions = previewToolInstructions(available).trim();
  return instructions.length > 0
    ? `<developer_instructions>\n${instructions}\n</developer_instructions>`
    : "";
}
