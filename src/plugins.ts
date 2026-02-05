import { readdirSync } from "fs";
import { join, resolve } from "path";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import { createLogger } from "./logger.js";

const log = createLogger("plugins");

export interface PluginExports {
  tool: {
    name: string;
    description: string;
    parameters: TSchema;
  };
  handler: (args: any) => Promise<string>;
}

const pluginsDir = resolve(import.meta.dirname, "../plugins");

export async function loadPlugins(): Promise<AgentTool[]> {
  log.info(`Loading from: ${pluginsDir}`);
  const agentTools: AgentTool[] = [];

  let files: string[];
  try {
    files = readdirSync(pluginsDir).filter(
      (f) => f.endsWith(".ts") && !f.startsWith("_")
    );
    log.info(`Found ${files.length} plugin files: ${files.join(", ")}`);
  } catch (err) {
    log.warn("No plugins directory found");
    return agentTools;
  }

  for (const file of files) {
    try {
      log.debug(`Loading plugin: ${file}...`);
      const mod = (await import(join(pluginsDir, file))) as PluginExports;
      log.debug(`Imported ${file}`);
      if (!mod.tool || !mod.handler) continue;

      const agentTool: AgentTool = {
        name: mod.tool.name,
        description: mod.tool.description,
        parameters: mod.tool.parameters,
        label: mod.tool.name,
        execute: async (
          _toolCallId: string,
          params: any
        ): Promise<AgentToolResult<any>> => {
          const result = await mod.handler(params);
          return {
            content: [{ type: "text", text: result }],
            details: {},
          };
        },
      };
      agentTools.push(agentTool);
      log.info(`Loaded plugin: ${mod.tool.name}`);
    } catch (err) {
      log.error(`Failed to load plugin ${file}:`, err);
    }
  }

  return agentTools;
}
