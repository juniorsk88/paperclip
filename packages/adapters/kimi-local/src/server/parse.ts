import { parseJson } from "@paperclipai/adapter-utils/server-utils";

const SESSION_RE = /^To resume this session: kimi -r (\S+)/;

export interface KimiOutputEvent {
  role?: string;
  content?: Array<{ type: string; text?: string; think?: string }>;
  type?: string;
  text?: string;
  error?: { message?: string };
  [key: string]: unknown;
}

export function parseKimiOutput(stdout: string): KimiOutputEvent[] {
  const events: KimiOutputEvent[] = [];
  let lastSessionId: string | null = null;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const sessionMatch = trimmed.match(SESSION_RE);
    if (sessionMatch) {
      lastSessionId = sessionMatch[1];
      continue;
    }

    const parsed = parseJson(trimmed);
    if (parsed) events.push(parsed as unknown as KimiOutputEvent);
  }

  if (lastSessionId) {
    events.push({ type: "session_info", session_id: lastSessionId });
  }

  return events;
}

export function isKimiUnknownSessionError(output: KimiOutputEvent[]): boolean {
  return output.some((event) => {
    if (event.role === "error" || event.type === "error") {
      return false;
    }
    return false;
  });
}

export function extractSessionId(output: KimiOutputEvent[]): string | null {
  const info = output.find((e) => e.type === "session_info");
  if (info && typeof info.session_id === "string") return info.session_id;
  return null;
}

export function extractAssistantText(output: KimiOutputEvent[]): string {
  const assistant = output.find((e) => e.role === "assistant");
  if (!assistant?.content) return "";
  return assistant.content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

export function extractThinkingText(output: KimiOutputEvent[]): string {
  const assistant = output.find((e) => e.role === "assistant");
  if (!assistant?.content) return "";
  return assistant.content
    .filter((c) => c.type === "think")
    .map((c) => c.think ?? "")
    .join("");
}

export function hasHelloResponse(output: KimiOutputEvent[]): boolean {
  const text = extractAssistantText(output).toLowerCase();
  return text.includes("hello");
}
