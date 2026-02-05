import {
  getModel,
  stream,
  validateToolCall,
  type Message,
  type ToolCall,
  type Tool,
} from "@mariozechner/pi-ai";
import { createCodingTools } from "@mariozechner/pi-coding-agent";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { createLogger } from "./logger.js";

const log = createLogger("agent");

let currentProvider = process.env.MODEL_PROVIDER || "anthropic";
let currentModelId = process.env.MODEL_ID || "claude-sonnet-4-5-20250929";

const codingTools = createCodingTools(process.cwd());

export function setModel(provider: string, modelId: string) {
  currentProvider = provider;
  currentModelId = modelId;
}

export function getModelInfo() {
  return { provider: currentProvider, modelId: currentModelId };
}

export async function runAgent(
  messages: Message[],
  systemPrompt: string,
  customTools: AgentTool[]
): Promise<string> {
  log.info(`Starting with ${messages.length} messages, ${customTools.length} custom tools`);

  const model = getModel(currentProvider as any, currentModelId as any);
  const allTools: AgentTool[] = [...codingTools, ...customTools];
  const toolDefs: Tool[] = allTools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));

  const toolHandlers = new Map<string, AgentTool>();
  for (const t of allTools) toolHandlers.set(t.name, t);

  const context = {
    systemPrompt,
    messages: [...messages],
    tools: toolDefs,
  };

  let turnCount = 0;
  while (true) {
    turnCount++;
    log.debug(`Turn ${turnCount}, context messages: ${context.messages.length}`);
    let text = "";
    const toolCalls: ToolCall[] = [];

    log.debug("Streaming response from model...");
    const s = stream(model, context);

    for await (const event of s) {
      if (event.type === "text_delta") {
        text += event.delta;
      } else if (event.type === "toolcall_end") {
        toolCalls.push(event.toolCall);
        log.info(`Tool call: ${event.toolCall.name}`);
      }
    }

    const assistantMessage = await s.result();
    context.messages.push(assistantMessage);
    log.debug(`Turn ${turnCount} complete - text: ${text.length} chars, tool calls: ${toolCalls.length}`);

    if (toolCalls.length === 0) {
      log.info(`No tool calls, returning response (${text.length} chars)`);
      return text;
    }

    // Execute tool calls
    log.info(`Executing ${toolCalls.length} tool calls...`);
    for (const tc of toolCalls) {
      const handler = toolHandlers.get(tc.name);
      if (!handler) {
        log.warn(`Unknown tool: ${tc.name}`);
        context.messages.push({
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: "text", text: `Unknown tool: ${tc.name}` }],
          isError: true,
          timestamp: Date.now(),
        });
        continue;
      }

      try {
        log.debug(`Executing tool: ${tc.name} (id: ${tc.id})`);
        const validated = validateToolCall(toolDefs, tc);
        const result = await handler.execute(tc.id, validated);
        log.debug(`Tool ${tc.name} succeeded, result: ${JSON.stringify(result.content).length} chars`);
        context.messages.push({
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: result.content,
          isError: false,
          timestamp: Date.now(),
        });
      } catch (err: any) {
        log.error(`Tool ${tc.name} failed: ${err.message}`);
        log.error(`Stack: ${err.stack}`);
        context.messages.push({
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
          timestamp: Date.now(),
        });
      }
    }
  }
}

export async function runCronPrompt(
  prompt: string,
  customTools: AgentTool[]
): Promise<string> {
  const messages: Message[] = [
    { role: "user", content: prompt, timestamp: Date.now() },
  ];
  const systemPrompt =
    "You are a scheduled task assistant. Execute the requested task concisely.";
  return runAgent(messages, systemPrompt, customTools);
}
