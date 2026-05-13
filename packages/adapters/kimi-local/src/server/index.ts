export { execute } from "./execute.js";
export { testEnvironment } from "./test.js";
export { parseKimiOutput, isKimiUnknownSessionError, extractSessionId } from "./parse.js";
export { listKimiSkills, syncKimiSkills } from "./skills.js";

import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";
import { extractSessionId } from "./parse.js";
import type { AdapterExecutionResult } from "@paperclipai/adapter-utils";

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.sessionId !== "string" || obj.sessionId.length === 0) return null;
    return { sessionId: obj.sessionId, cwd: obj.cwd ?? null };
  },
  serialize(params: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!params) return null;
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
    const cwd = typeof params.cwd === "string" ? params.cwd : "";
    if (!sessionId) return null;
    return { sessionId, cwd };
  },
  getDisplayId(params: Record<string, unknown> | null): string | null {
    if (!params) return null;
    return typeof params.sessionId === "string" ? params.sessionId.slice(0, 8) : null;
  },
};
