import pc from "picocolors";

function safeParseJson(value: string): Record<string, unknown> | null {
  try {
    const result = JSON.parse(value);
    if (typeof result === "object" && result !== null) return result as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

interface KimiStreamEvent {
  type: string;
  subtype?: string;
  text?: string;
  message?: { content?: Array<{ type: string; text?: string }>; model?: string };
  content?: string;
  result?: string;
  error?: { message?: string };
}

export function printKimiStreamEvent(raw: string, debug: boolean): void {
  const trimmed = raw.trim();
  if (!trimmed) return;
  const parsed = safeParseJson(trimmed);
  if (!parsed) {
    if (debug) process.stdout.write(pc.gray(raw));
    return;
  }

  const event = parsed as unknown as KimiStreamEvent;

  switch (event.type) {
    case "system":
      if (event.subtype === "init") {
        process.stdout.write(pc.cyan(`[Kimi] model: ${event.message?.model ?? "unknown"}\n`));
      }
      break;
    case "assistant": {
      const text = event.message?.content?.map((c) => c.text ?? "").join("") ?? event.text ?? "";
      if (text) process.stdout.write(pc.green(text));
      break;
    }
    case "thinking":
      if (event.text) process.stdout.write(pc.yellow(event.text));
      break;
    case "result":
      process.stdout.write(pc.dim(`\n[result] ${event.result ?? event.content ?? ""}\n`));
      break;
    case "error":
      process.stdout.write(pc.red(`\n[error] ${event.error?.message ?? event.message ?? "Unknown"}\n`));
      break;
    default:
      if (debug) process.stdout.write(pc.gray(raw));
  }
}
