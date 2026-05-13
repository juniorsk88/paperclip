import type { UIAdapterModule } from "../types";
import { parseKimiStdoutLine } from "@paperclipai/adapter-kimi-local/ui";
import { buildKimiConfig } from "@paperclipai/adapter-kimi-local/ui";
import { SchemaConfigFields } from "../schema-config-fields";

export const kimiLocalUIAdapter: UIAdapterModule = {
  type: "kimi_local",
  label: "Kimi Code (local)",
  parseStdoutLine: parseKimiStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildKimiConfig,
};
