import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function safeParseJson(value: string): Record<string, unknown> | null {
  try {
    const result = JSON.parse(value);
    if (typeof result === "object" && result !== null) return result as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

interface KimiContentBlock {
  type: string;
  text?: string;
  think?: string;
  name?: string;
  input?: unknown;
}

interface KimiToolCall {
  type: string;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface KimiStreamEvent {
  role?: string;
  content?: KimiContentBlock[];
  tool_calls?: KimiToolCall[];
  tool_call_id?: string;
  type?: string;
  text?: string;
  result?: string;
  isError?: boolean;
  error?: { message?: string };
  usage?: { input_tokens?: number; output_tokens?: number; cached_tokens?: number };
  session_id?: string;
}

export function parseKimiStdoutLine(raw: string, ts: string): TranscriptEntry[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const parsed = safeParseJson(trimmed);
  if (!parsed) return [{ kind: "stdout", ts, text: raw }];

  const event = parsed as unknown as KimiStreamEvent;
  const role = event.role;

  if (role === "assistant") {
    const entries: TranscriptEntry[] = [];
    const thinkText = event.content?.filter((c) => c.type === "think").map((c) => c.think ?? "").join("");
    const asstText = event.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");

    if (thinkText) {
      entries.push({ kind: "thinking", ts, text: thinkText });
    }

    if (asstText) {
      entries.push({ kind: "assistant", ts, text: asstText });
    }

    if (Array.isArray(event.tool_calls)) {
      for (const tc of event.tool_calls) {
        let parsedInput: unknown = {};
        try {
          parsedInput = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch { /* keep default */ }
        entries.push({
          kind: "tool_call",
          ts,
          name: tc.function?.name ?? tc.type ?? "unknown",
          input: parsedInput,
          toolUseId: tc.id,
        });
      }
    }

    return entries.length > 0 ? entries : [{ kind: "assistant", ts, text: raw }];
  }

  if (role === "tool") {
    const text = Array.isArray(event.content)
      ? event.content.map((c) => c.text ?? "").join("")
      : typeof event.content === "string"
        ? event.content
        : "";
    return [{
      kind: "tool_result",
      ts,
      toolUseId: event.tool_call_id ?? "",
      content: text || raw,
      isError: event.isError ?? false,
    }];
  }

  if (event.type === "error" || role === "error") {
    const errMsg = typeof event.error?.message === "string" ? event.error.message : raw;
    return [{ kind: "stderr", ts, text: errMsg }];
  }

  return [{ kind: "stdout", ts, text: raw }];
}
