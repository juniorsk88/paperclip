import { describe, expect, it } from "vitest";
import {
  extractAssistantText,
  extractSessionId,
  isKimiUnknownSessionError,
  parseKimiOutput,
} from "./parse.js";

describe("kimi parser", () => {
  it("extracts session id from Kimi resume hint", () => {
    const output = parseKimiOutput([
      JSON.stringify({ role: "assistant", content: [{ type: "text", text: "done" }] }),
      "To resume this session: kimi -r kimi-session-1",
    ].join("\n"));

    expect(extractSessionId(output)).toBe("kimi-session-1");
    expect(extractAssistantText(output)).toBe("done");
  });

  it("detects stale session errors from structured error fields", () => {
    expect(isKimiUnknownSessionError([
      { type: "error", error: { message: "Session not found" } },
    ])).toBe(true);
    expect(isKimiUnknownSessionError([
      { role: "error", message: "unknown session id" },
    ])).toBe(true);
  });
});
