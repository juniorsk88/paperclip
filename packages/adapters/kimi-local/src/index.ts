import type { AdapterModelProfileDefinition } from "@paperclipai/adapter-utils";

export const type = "kimi_local";
export const label = "Kimi Code (local)";

export const SANDBOX_INSTALL_COMMAND = "npm install -g @moonshotai/kimi-cli";

export const models = [
  { id: "kimi-code/kimi-for-coding", label: "Kimi K2.6" },
  { id: "kimi-code/kimi-sonnet-v5", label: "Kimi Sonnet V5" },
  { id: "kimi-code/kimi-haiku-v42", label: "Kimi Haiku V4.2" },
];

export const modelProfiles: AdapterModelProfileDefinition[] = [
  {
    key: "cheap",
    label: "Cheap",
    description: "Use Kimi K2.6 as the budget lane.",
    adapterConfig: {
      model: "kimi-code/kimi-for-coding",
      effort: "low",
    },
    source: "adapter_default",
  },
];

export const agentConfigurationDoc = `# kimi_local agent configuration

Adapter: kimi_local

Use when:
- You need a frontend/UI-focused agent with strong visual and design skills
- The agent needs to run Kimi Code CLI locally on the host machine
- You need session persistence across runs (Kimi supports session resumption)

Don't use when:
- You need a simple one-shot script execution (use "process" adapter instead)
- Kimi CLI is not installed on the host

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file injected at runtime
- model (string, optional): Kimi model id (default: kimi-k2.6)
- effort (string, optional): reasoning effort (low|medium|high)
- dangerouslySkipPermissions (boolean, optional, default true): pass --yolo to Kimi; defaults to true because Paperclip runs Kimi in headless --print mode where interactive permission prompts cannot be answered
- command (string, optional): defaults to "kimi"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables
- workspaceStrategy (object, optional): execution workspace strategy
- workspaceRuntime (object, optional): reserved for workspace runtime metadata

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds
`;
