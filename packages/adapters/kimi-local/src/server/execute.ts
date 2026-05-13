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
  resolvePaperclipDesiredSkillNames,
  readPaperclipRuntimeSkillEntries,
  ensurePaperclipSkillSymlink,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
} from "@paperclipai/adapter-utils/server-utils";
import { parseKimiOutput, isKimiUnknownSessionError, extractSessionId, extractAssistantText, type KimiOutputEvent } from "./parse.js";

async function buildPrompt(agent: AdapterExecutionContext["agent"], context: AdapterExecutionContext["context"]): Promise<string> {
  const config = (agent.adapterConfig ?? {}) as Record<string, unknown>;
  const promptTemplate = asString(config.promptTemplate, DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE);
  const instructionsPath = asString(config.instructionsFilePath, "");
  let instructions = "";
  if (instructionsPath) {
    try {
      const fs = await import("node:fs");
      instructions = await fs.promises.readFile(instructionsPath, "utf-8");
    } catch {
      // instructions file not found
    }
  }
  return renderTemplate(promptTemplate, {
    agentId: agent.id,
    companyId: agent.companyId,
    runId: context.runId,
    company: {},
    agent: { name: agent.name },
    run: {},
    context: context as Record<string, unknown>,
  });
}

function buildArgs(config: Record<string, unknown>, sessionId: string | null, prompt: string, skillsDir?: string): { args: string[]; stdin: string } {
  const args: string[] = [];
  const dangerouslySkipPermissions = asBoolean(config.dangerouslySkipPermissions, true);

  args.push("--print", "--output-format", "stream-json");
  args.push("--model", asString(config.model, "kimi-code/kimi-for-coding"));

  if (sessionId) {
    args.push("--session", sessionId);
  }

  if (dangerouslySkipPermissions) {
    args.push("--yolo");
  }

  if (skillsDir) {
    args.push("--skills-dir", skillsDir);
  }

  args.push("--input-format", "text");

  const extraArgs = asStringArray(config.extraArgs);
  if (extraArgs) args.push(...extraArgs);

  return { args, stdin: prompt };
}

function buildCwd(config: Record<string, unknown>): string {
  const cwd = asString(config.cwd, process.cwd());
  return cwd || process.cwd();
}

async function buildEnv(
  agent: AdapterExecutionContext["agent"],
  config: Record<string, unknown>,
  cwd: string,
  authToken: string | undefined,
): Promise<Record<string, string>> {
  const env = buildPaperclipEnv(agent);
  env.PAPERCLIP_CWD = cwd;
  if (authToken) env.PAPERCLIP_API_KEY = authToken;
  const userEnv = config.env as Record<string, string> | undefined;
  if (userEnv) {
    for (const [key, value] of Object.entries(userEnv)) {
      if (typeof value === "string") env[key] = value;
    }
  }
  env.PATH = `${os.homedir()}/.local/bin:/usr/local/bin:/usr/bin:/bin`;
  return env;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  console.error("[kimi-debug] execute called", JSON.stringify({ agent: ctx.agent?.id, runId: ctx.runId }).slice(0, 200));
  try {
  const { agent, runtime, config, context, onLog, onMeta } = ctx;
  const cwd = buildCwd(config);
  const command = asString(config.command, "kimi");

  await ensureAbsoluteDirectory(cwd);
  await ensureCommandResolvable(command, cwd, process.env as Record<string, string>);

  const runtimeSessionId = asString(runtime.sessionParams?.sessionId, "");
  const runtimeSessionCwd = asString(runtime.sessionParams?.cwd, "");
  const canResumeSession = runtimeSessionId.length > 0 && (runtimeSessionCwd.length === 0 || runtimeSessionCwd === cwd);
  const sessionId = canResumeSession ? runtimeSessionId : null;

  const env = await buildEnv(agent, config, cwd, ctx.authToken);
  const prompt = await buildPrompt(agent, context);

  const skillsHome = path.join(os.homedir(), ".kimi", "skills", "paperclip");
  const skillsDir = await fs.stat(skillsHome).then(() => skillsHome).catch(() => undefined);

  async function runAttempt(sid: string | null): Promise<{ proc: Awaited<ReturnType<typeof runChildProcess>>; output: KimiOutputEvent[] }> {
    const { args, stdin } = buildArgs(config, sid, prompt, skillsDir);
    const graceSec = asNumber(config.graceSec, 15);
    const timeoutSec = asNumber(config.timeoutSec, 0);

    if (onMeta) {
      const meta: AdapterInvocationMeta = {
        adapterType: "kimi_local",
        command,
        commandArgs: args,
        cwd,
        env: redactEnvForLogs(env),
      };
      await onMeta(meta);
    }

    const kimiOnLog = (kind: "stdout" | "stderr", line: string): Promise<void> => {
      const trimmed = line.trim();
      if (!trimmed) return Promise.resolve();
      if (kind === "stdout") {
        const parsed = parseSingleKimiEvent(trimmed);
        if (parsed) {
          if (parsed.kind === "thinking") return onLog("stdout", `💭 ${parsed.text ?? ""}`);
          if (parsed.kind === "assistant") return onLog("stdout", parsed.text ?? "");
          if (parsed.kind === "tool_call") {
            onLog("stdout", `🛠 ${parsed.name ?? ""}`);
            return onLog("stdout", JSON.stringify(parsed.input));
          }
          if (parsed.kind === "tool_result") {
            return onLog("stdout", parsed.text ? `📋 ${parsed.text.slice(0, 200)}` : "");
          }
          if (parsed.kind === "stderr") return onLog("stderr", parsed.text ?? "");
          if (parsed.kind === "init") return Promise.resolve();
          if (parsed.kind === "result") return Promise.resolve();
          return onLog("stdout", trimmed);
        }
      }
      return onLog(kind, trimmed);
    };

    function parseSingleKimiEvent(raw: string): { kind: string; text?: string; name?: string; input?: unknown } | null {
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
            let input: unknown = {};
            try { input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch {}
            return { kind: "tool_call", name: tc.function?.name ?? tc.type ?? "unknown", input };
          }
        }
        if (event.role === "tool") {
          const text = Array.isArray(event.content)
            ? event.content.map((c: { text?: string }) => c.text ?? "").join("")
            : typeof event.content === "string" ? event.content : "";
          return { kind: "tool_result", text };
        }
        return null;
      } catch {
        return null;
      }
    }

    const proc = await runChildProcess(ctx.runId, command, args, {
      cwd,
      env,
      stdin,
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
    return toResult(retry, { clearSessionOnMissingSession: true });
  }

  return toResult({ proc, output }, { sessionId, cwd });
  } catch (err) {
    console.error("[kimi-debug] execute failed", err);
    throw err;
  }
}

function toResult(
  { proc, output }: { proc: Awaited<ReturnType<typeof runChildProcess>>; output: KimiOutputEvent[] },
  opts: { sessionId?: string | null; cwd?: string; clearSessionOnMissingSession?: boolean } = {},
): AdapterExecutionResult {
  const lastAssistant = output.filter((e) => e.role === "assistant").pop();
  const errorEvents = output.filter((e) => e.type === "error");

  const result: AdapterExecutionResult = {
    exitCode: proc.exitCode,
    signal: proc.signal,
    timedOut: proc.timedOut,
    errorMessage: errorEvents.map((e) => typeof e.message === "string" ? e.message : "").filter(Boolean).join("\n") || undefined,
    usage: undefined,
    sessionId: opts.sessionId ?? undefined,
    sessionParams: opts.sessionId ? { sessionId: opts.sessionId, cwd: opts.cwd } : null,
    summary: lastAssistant?.text ?? undefined,
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
