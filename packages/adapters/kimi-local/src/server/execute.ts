import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterExecutionContext, AdapterExecutionResult, AdapterInvocationMeta } from "@paperclipai/adapter-utils";
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  buildPaperclipEnv,
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  ensurePathInEnv,
  redactEnvForLogs,
  renderTemplate,
  runChildProcess,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  joinPromptSections,
} from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_KIMI_LOCAL_MODEL } from "../index.js";
import { parseKimiOutput, isKimiUnknownSessionError, extractSessionId, extractAssistantText, type KimiOutputEvent } from "./parse.js";

const KIMI_LANGUAGE_POLICY =
  "Language policy: responda em português brasileiro em mensagens de usuário, comentários, documentos, handoffs e resumos. Preserve nomes de APIs, comandos, paths, logs, código, payloads JSON e texto citado no idioma original quando necessário. Se uma skill ou instrução de ferramenta pedir inglês, esta regra de idioma prevalece para a prosa natural.";

async function buildPrompt(
  agent: AdapterExecutionContext["agent"],
  config: Record<string, unknown>,
  context: AdapterExecutionContext["context"],
): Promise<string> {
  const promptTemplate = asString(config.promptTemplate, DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE);
  const instructionsPath = asString(config.instructionsFilePath, "");
  let instructionsPrefix = "";
  if (instructionsPath) {
    try {
      const instructions = await fs.readFile(instructionsPath, "utf-8");
      const instructionsDir = `${path.dirname(instructionsPath)}/`;
      instructionsPrefix =
        `${instructions}\n\n` +
        `The above agent instructions were loaded from ${instructionsPath}. ` +
        `Resolve any relative file references from ${instructionsDir}.`;
    } catch {
      instructionsPrefix = `Configured instructionsFilePath ${instructionsPath}, but Paperclip could not read it.`;
    }
  }
  const renderedPrompt = renderTemplate(promptTemplate, {
    agentId: agent.id,
    companyId: agent.companyId,
    runId: context.runId,
    company: {},
    agent,
    run: {},
    context: context as Record<string, unknown>,
  });
  return joinPromptSections([KIMI_LANGUAGE_POLICY, instructionsPrefix, renderedPrompt]);
}

function buildArgs(config: Record<string, unknown>, sessionId: string | null, prompt: string, skillsDir?: string): string[] {
  const args: string[] = [];
  const dangerouslySkipPermissions = asBoolean(config.dangerouslySkipPermissions, true);

  args.push("--print", "--output-format", "stream-json");
  args.push("--model", asString(config.model, DEFAULT_KIMI_LOCAL_MODEL));

  if (sessionId) {
    args.push("-r", sessionId);
  }

  if (dangerouslySkipPermissions) {
    args.push("--yolo");
  }

  if (skillsDir) {
    args.push("--skills-dir", skillsDir);
  }

  const extraArgs = asStringArray(config.extraArgs);
  if (extraArgs) args.push(...extraArgs);

  args.push("--prompt", prompt);
  return args;
}

function buildCwd(config: Record<string, unknown>): string {
  const cwd = asString(config.cwd, process.cwd());
  return cwd || process.cwd();
}

async function buildEnv(
  agent: AdapterExecutionContext["agent"],
  config: Record<string, unknown>,
  cwd: string,
  runId: string,
  authToken: string | undefined,
): Promise<Record<string, string>> {
  const env = { ...process.env, ...buildPaperclipEnv(agent) } as Record<string, string>;
  env.PAPERCLIP_CWD = cwd;
  env.PAPERCLIP_RUN_ID = runId;
  if (authToken) env.PAPERCLIP_API_KEY = authToken;
  const userEnv = config.env as Record<string, string> | undefined;
  if (userEnv) {
    for (const [key, value] of Object.entries(userEnv)) {
      if (typeof value === "string") env[key] = value;
    }
  }
  env.PATH = ensurePathInEnv(env).PATH ?? `${os.homedir()}/.local/bin:/usr/local/bin:/usr/bin:/bin`;
  return env;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { agent, runtime, config, context, onLog, onMeta } = ctx;
  const cwd = buildCwd(config);
  const command = asString(config.command, "kimi");

  await ensureAbsoluteDirectory(cwd);
  await ensureCommandResolvable(command, cwd, process.env as Record<string, string>);

  const runtimeSessionId = asString(runtime.sessionParams?.sessionId, "");
  const runtimeSessionCwd = asString(runtime.sessionParams?.cwd, "");
  const canResumeSession = runtimeSessionId.length > 0 && (runtimeSessionCwd.length === 0 || runtimeSessionCwd === cwd);
  const sessionId = canResumeSession ? runtimeSessionId : null;

  const env = await buildEnv(agent, config, cwd, ctx.runId, ctx.authToken);
  const prompt = await buildPrompt(agent, config, context);

  const skillsHome = path.join(os.homedir(), ".kimi", "skills", "paperclip");
  const skillsDir = await fs.stat(skillsHome).then(() => skillsHome).catch(() => undefined);

  async function runAttempt(sid: string | null): Promise<{ proc: Awaited<ReturnType<typeof runChildProcess>>; output: KimiOutputEvent[] }> {
    const args = buildArgs(config, sid, prompt, skillsDir);
    const graceSec = asNumber(config.graceSec, 15);
    const timeoutSec = asNumber(config.timeoutSec, 0);

    if (onMeta) {
      const meta: AdapterInvocationMeta = {
        adapterType: "kimi_local",
        command,
        commandArgs: args.map((value, index) => (
          index > 0 && args[index - 1] === "--prompt" ? `<prompt ${prompt.length} chars>` : value
        )),
        cwd,
        env: redactEnvForLogs(env),
        prompt,
      };
      await onMeta(meta);
    }

    const kimiOnLog = async (kind: "stdout" | "stderr", chunk: string): Promise<void> => {
      const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length === 0) return;

      for (const line of lines) {
        if (kind !== "stdout") {
          await onLog(kind, line);
          continue;
        }

        const parsed = parseSingleKimiEvent(line);
        if (!parsed) {
          await onLog("stdout", line);
          continue;
        }
        if (parsed.kind === "thinking") {
          await onLog("stdout", `Pensando: ${parsed.text ?? ""}`);
          continue;
        }
        if (parsed.kind === "assistant") {
          await onLog("stdout", parsed.text ?? "");
          continue;
        }
        if (parsed.kind === "tool_call") {
          await onLog("stdout", `Usando ferramenta: ${parsed.name ?? "desconhecida"}`);
          continue;
        }
        if (parsed.kind === "tool_result") {
          if (parsed.text) await onLog("stdout", `Resultado da ferramenta: ${parsed.text}`);
          continue;
        }
        if (parsed.kind === "stderr") {
          await onLog("stderr", parsed.text ?? "");
        }
      }
    };

    function parseSingleKimiEvent(raw: string): { kind: string; text?: string; name?: string } | null {
      try {
        const event = JSON.parse(raw);
        if (event.type === "init") return { kind: "init" };
        if (event.type === "result") return { kind: "result" };
        if (event.type === "error") return { kind: "stderr", text: event.error?.message ?? event.text ?? raw };
        if (event.role === "assistant") {
          const thinkText = event.content?.filter((c: { type: string }) => c.type === "think").map((c: { think?: string }) => c.think ?? "").join("");
          const asstText = event.content?.filter((c: { type: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("");
          if (thinkText) return { kind: "thinking", text: thinkText };
          if (asstText) return { kind: "assistant", text: asstText };
          if (Array.isArray(event.tool_calls) && event.tool_calls.length > 0) {
            const tc = event.tool_calls[0];
            return { kind: "tool_call", name: tc.function?.name ?? tc.type ?? "unknown" };
          }
        }
        if (event.role === "tool") {
          const text = summarizeKimiToolContent(event.content);
          return { kind: "tool_result", text };
        }
        return null;
      } catch {
        return null;
      }
    }

    function summarizeKimiToolContent(content: unknown): string {
      const text = Array.isArray(content)
        ? content.map((entry) => (
            typeof entry === "object" && entry !== null && typeof (entry as { text?: unknown }).text === "string"
              ? (entry as { text: string }).text
              : ""
          )).filter(Boolean).join("\n")
        : typeof content === "string" ? content : "";
      const systemMatch = text.match(/<system>([\s\S]*?)<\/system>/i);
      const summary = (systemMatch?.[1] ?? text)
        .replace(/\s+/g, " ")
        .trim();
      return summary.length > 320 ? `${summary.slice(0, 317)}...` : summary;
    }

    const proc = await runChildProcess(ctx.runId, command, args, {
      cwd,
      env,
      timeoutSec: timeoutSec > 0 ? timeoutSec : 600,
      graceSec,
      onLog: kimiOnLog,
    });

    const output = parseKimiOutput(proc.stdout);
    return { proc, output };
  }

  const { proc, output } = await runAttempt(sessionId);

  if (sessionId && !proc.timedOut && (proc.exitCode !== 0 || isKimiUnknownSessionError(output))) {
    const retry = await runAttempt(null);
    return toResult(retry, { clearSessionOnMissingSession: true, cwd, model: asString(config.model, DEFAULT_KIMI_LOCAL_MODEL) });
  }

  return toResult({ proc, output }, { sessionId, cwd, model: asString(config.model, DEFAULT_KIMI_LOCAL_MODEL) });
}

function toResult(
  { proc, output }: { proc: Awaited<ReturnType<typeof runChildProcess>>; output: KimiOutputEvent[] },
  opts: { sessionId?: string | null; cwd?: string; model?: string; clearSessionOnMissingSession?: boolean } = {},
): AdapterExecutionResult {
  const errorEvents = output.filter((e) => e.type === "error");
  const resolvedSessionId = extractSessionId(output) ?? opts.sessionId ?? null;
  const failed = (proc.exitCode ?? 0) !== 0;
  const errorMessage = errorEvents
    .map((e) => (
      typeof e.error?.message === "string" ? e.error.message :
      typeof e.message === "string" ? e.message :
      typeof e.text === "string" ? e.text :
      ""
    ))
    .filter(Boolean)
    .join("\n") || (failed ? firstNonEmptyLine(proc.stderr) || `Kimi exited with code ${proc.exitCode ?? -1}` : null);

  const result: AdapterExecutionResult = {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: proc.timedOut,
    errorMessage,
    usage: undefined,
    sessionId: resolvedSessionId ?? undefined,
    sessionParams: resolvedSessionId ? { sessionId: resolvedSessionId, cwd: opts.cwd } : null,
    sessionDisplayId: resolvedSessionId ?? undefined,
    provider: "moonshot",
    biller: "moonshot",
    model: opts.model ?? DEFAULT_KIMI_LOCAL_MODEL,
    summary: extractAssistantText(output) || undefined,
    resultJson: {
      stdout: proc.stdout,
      stderr: proc.stderr,
    },
  };

  if (opts.clearSessionOnMissingSession) {
    result.clearSession = true;
  }

  return result;
}

function firstNonEmptyLine(value: string): string | null {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}
