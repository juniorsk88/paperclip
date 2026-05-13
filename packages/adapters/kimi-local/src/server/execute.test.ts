import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "./execute.js";

async function writeFakeKimiCommand(commandPath: string): Promise<void> {
  const script = `#!/bin/sh
if [ -n "$PAPERCLIP_TEST_CAPTURE_PATH" ]; then
  {
    printf 'ARG:%s\\n' "$@"
    env | grep '^PAPERCLIP_' | cut -d= -f1 | sort | sed 's/^/ENV:/'
  } > "$PAPERCLIP_TEST_CAPTURE_PATH"
fi
printf '%s\\n' '{"role":"assistant","content":[{"type":"text","text":"hello from kimi"}]}'
printf '%s\\n' '{"role":"assistant","tool_calls":[{"id":"tool-1","type":"function","function":{"name":"ReadFile","arguments":"{\\"path\\":\\"README.md\\"}"}}]}'
printf '%s\\n' '{"role":"tool","tool_call_id":"tool-1","content":[{"type":"text","text":"<system>Command executed successfully.</system>"},{"type":"text","text":"{\\"raw\\":\\"json\\"}"}]}'
printf '%s\\n' 'To resume this session: kimi -r kimi-session-1'
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

async function writeStaleThenSuccessKimiCommand(commandPath: string): Promise<void> {
  const script = `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "-r" ]; then
    printf '%s\\n' '{"type":"error","error":{"message":"Session not found"}}'
    exit 1
  fi
done
printf '%s\\n' '{"role":"assistant","content":[{"type":"text","text":"fresh session"}]}'
printf '%s\\n' 'To resume this session: kimi -r kimi-session-2'
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

describe("kimi execute", () => {
  it("passes prompt via --prompt, injects instructions, and saves session id", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kimi-execute-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "kimi");
    const capturePath = path.join(root, "capture.json");
    const instructionsPath = path.join(root, "KIMI.md");
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(instructionsPath, "Use concise answers.", "utf8");
    await writeFakeKimiCommand(commandPath);

    try {
      let prompt = "";
      const logs: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
      const result = await execute({
        runId: "run-1",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Kimi Coder",
          adapterType: "kimi_local",
          adapterConfig: {},
        },
        runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
        config: {
          command: commandPath,
          cwd: workspace,
          instructionsFilePath: instructionsPath,
          env: { PAPERCLIP_TEST_CAPTURE_PATH: capturePath },
          promptTemplate: "Heartbeat for {{agent.name}}.",
        },
        context: {},
        authToken: "run-jwt-token",
        onLog: async (stream, text) => {
          logs.push({ stream, text });
        },
        onMeta: async (meta) => {
          prompt = meta.prompt ?? "";
        },
      });

      const captureText = await fs.readFile(capturePath, "utf8");
      const captureLines = captureText.trim().split(/\r?\n/);
      const argv = captureLines.filter((line) => line.startsWith("ARG:")).map((line) => line.slice(4));
      const paperclipEnvKeys = captureLines.filter((line) => line.startsWith("ENV:")).map((line) => line.slice(4));
      expect(argv).toContain("--prompt");
      expect(argv).toContain("--yolo");
      expect(argv).not.toContain("--session");
      expect(argv).not.toContain("--input-format");
      expect(captureText).toContain("Heartbeat for Kimi Coder.");
      expect(captureText).toContain("Use concise answers.");
      expect(captureText).toContain("responda em português brasileiro");
      expect(paperclipEnvKeys).toEqual(expect.arrayContaining([
        "PAPERCLIP_AGENT_ID",
        "PAPERCLIP_API_KEY",
        "PAPERCLIP_COMPANY_ID",
        "PAPERCLIP_RUN_ID",
      ]));
      expect(prompt).toContain("Use concise answers.");
      expect(prompt).toContain("responda em português brasileiro");
      expect(result.exitCode).toBe(0);
      expect(result.sessionId).toBe("kimi-session-1");
      expect(result.sessionParams).toEqual({ sessionId: "kimi-session-1", cwd: workspace });
      expect(result.summary).toBe("hello from kimi");
      expect(logs.map((entry) => entry.text)).toEqual(expect.arrayContaining([
        "hello from kimi",
        "Usando ferramenta: ReadFile",
        "Resultado da ferramenta: Command executed successfully.",
      ]));
      expect(logs.some((entry) => entry.text.trim().startsWith("{"))).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("resumes with -r and retries fresh when the saved session is stale", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kimi-stale-"));
    const workspace = path.join(root, "workspace");
    const commandPath = path.join(root, "kimi");
    await fs.mkdir(workspace, { recursive: true });
    await writeStaleThenSuccessKimiCommand(commandPath);

    try {
      const result = await execute({
        runId: "run-2",
        agent: { id: "agent-1", companyId: "company-1", name: "Kimi", adapterType: "kimi_local", adapterConfig: {} },
        runtime: {
          sessionId: null,
          sessionParams: { sessionId: "old-session", cwd: workspace },
          sessionDisplayId: null,
          taskKey: null,
        },
        config: { command: commandPath, cwd: workspace, promptTemplate: "Continue." },
        context: {},
        authToken: "run-jwt-token",
        onLog: async () => {},
      });

      expect(result.exitCode).toBe(0);
      expect(result.clearSession).toBe(true);
      expect(result.sessionId).toBe("kimi-session-2");
      expect(result.summary).toBe("fresh session");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
