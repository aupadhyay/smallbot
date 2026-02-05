import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

const smallbotDir = resolve(import.meta.dirname, "../.smallbot");
const memoryDir = resolve(smallbotDir, "memory");

function ensureSmallbotDir() {
  if (!existsSync(smallbotDir)) mkdirSync(smallbotDir, { recursive: true });
}

function ensureMemoryDir() {
  ensureSmallbotDir();
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
}

function memoryPath(userId: number): string {
  return resolve(memoryDir, `${userId}.md`);
}

export function loadMemories(userId: number): string {
  ensureMemoryDir();
  const path = memoryPath(userId);
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

export function loadTone(): string | null {
  ensureSmallbotDir();
  const tonePath = resolve(smallbotDir, "TONE.md");
  try {
    return readFileSync(tonePath, "utf-8");
  } catch {
    return null;
  }
}

export function saveTone(content: string): void {
  ensureSmallbotDir();
  const tonePath = resolve(smallbotDir, "TONE.md");
  writeFileSync(tonePath, content);
}

export function createToneTools(): AgentTool<any>[] {
  return [
    {
      name: "set_tone",
      description:
        "Save the bot's identity and tone preferences to TONE.md. Use this after the user tells you who you are and what tone to use.",
      parameters: Type.Object({
        content: Type.String({ description: "The tone and identity instructions to save" }),
      }),
      label: "set_tone",
      execute: async (
        _toolCallId: string,
        params: any
      ): Promise<AgentToolResult<any>> => {
        saveTone(params.content);
        return {
          content: [{ type: "text", text: "Tone saved." }],
          details: {},
        };
      },
    },
  ];
}

export function createMemoryTools(userId: number): AgentTool<any>[] {
  return [
    {
      name: "save_memory",
      description:
        "Save important information to persistent memory. Use for preferences, facts, and anything worth remembering across conversations. Don't save trivial conversation.",
      parameters: Type.Object({
        content: Type.String({ description: "The information to remember" }),
      }),
      label: "save_memory",
      execute: async (
        _toolCallId: string,
        params: any
      ): Promise<AgentToolResult<any>> => {
        ensureMemoryDir();
        const path = memoryPath(userId);
        const timestamp = new Date().toISOString();
        const entry = `\n## ${timestamp}\n${params.content}\n`;
        let existing = "";
        try {
          existing = readFileSync(path, "utf-8");
        } catch {}
        writeFileSync(path, existing + entry);
        return {
          content: [{ type: "text", text: "Memory saved." }],
          details: {},
        };
      },
    },
    {
      name: "recall_memories",
      description: "Retrieve all saved memories for this user.",
      parameters: Type.Object({}),
      label: "recall_memories",
      execute: async (): Promise<AgentToolResult<any>> => {
        const memories = loadMemories(userId);
        return {
          content: [
            {
              type: "text",
              text: memories || "No memories saved yet.",
            },
          ],
          details: {},
        };
      },
    },
  ];
}
