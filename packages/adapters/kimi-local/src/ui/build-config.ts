import type { CreateConfigValues } from "@paperclipai/adapter-utils";

export function buildKimiConfig(v: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {};
  if (v.cwd) ac.cwd = v.cwd;
  if (v.instructionsFilePath) ac.instructionsFilePath = v.instructionsFilePath;
  if (v.model) ac.model = v.model;
  if (v.promptTemplate) ac.promptTemplate = v.promptTemplate;
  ac.timeoutSec = 0;
  ac.graceSec = 15;
  ac.dangerouslySkipPermissions = true;
  return ac;
}
