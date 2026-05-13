import {
  ensureAbsoluteDirectory,
  ensureCommandResolvable,
  asString,
  runChildProcess,
} from "@paperclipai/adapter-utils/server-utils";
import { parseKimiOutput, hasHelloResponse, type KimiOutputEvent } from "./parse.js";
import type { AdapterEnvironmentTestContext, AdapterEnvironmentTestResult } from "@paperclipai/adapter-utils";

export async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const config = ctx.config ?? {};
  const rawCwd = asString(config.cwd, process.cwd());
  const cwd = rawCwd || process.cwd();
  const command = asString(config.command, "kimi");
  const checks: AdapterEnvironmentTestResult["checks"] = [];
  const now = new Date().toISOString();

  // Check working directory
  try {
    await ensureAbsoluteDirectory(cwd);
    checks.push({
      code: "kimi_working_dir_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch {
    checks.push({
      code: "kimi_working_dir_invalid",
      level: "error",
      message: `Working directory does not exist: ${cwd}`,
    });
  }

  // Check command
  try {
    await ensureCommandResolvable(command, cwd, process.env);
    checks.push({
      code: "kimi_command_executable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch {
    checks.push({
      code: "kimi_command_not_found",
      level: "error",
      message: `Command not found in PATH: "${command}"`,
      hint: `Install Kimi CLI: npm install -g @moonshotai/kimi-cli`,
    });
  }

  // Hello probe
  try {
    const proc = await runChildProcess("hello-probe", command, [
      "--print", "--output-format", "stream-json",
      "--model", "kimi-code/kimi-for-coding",
      "--prompt", "Respond with hello.",
    ], { cwd, env: process.env as Record<string, string>, graceSec: 15, timeoutSec: 30, onLog: async () => {} });

    const output = parseKimiOutput(proc.stdout);
    const hasHello = hasHelloResponse(output);
    const hasError = output.some((e) => e.type === "error");

    if (hasHello) {
      checks.push({
        code: "kimi_hello_probe_passed",
        level: "info",
        message: "Kimi hello probe succeeded.",
      });
    } else if (hasError) {
      checks.push({
        code: "kimi_hello_probe_failed",
        level: "error",
        message: "Kimi hello probe failed.",
        detail: output.filter((e) => e.role === "error").map((e) => JSON.stringify(e)).join("\n"),
        hint: "Run `kimi --print - --output-format stream-json --prompt 'Respond with hello.'` manually to debug.",
      });
    } else {
      checks.push({
        code: "kimi_hello_probe_unexpected_output",
        level: "warn",
        message: "Kimi hello probe returned unexpected output.",
        hint: "Check if Kimi is logged in: run `kimi login`.",
      });
    }
  } catch (err: unknown) {
    checks.push({
      code: "kimi_hello_probe_crashed",
      level: "error",
      message: `Kimi hello probe crashed: ${(err as Error).message}`,
    });
  }

  const status = checks.some((c) => c.level === "error") ? "fail" : checks.some((c) => c.level === "warn") ? "warn" : "pass";
  return { adapterType: "kimi_local", status, checks, testedAt: now };
}
