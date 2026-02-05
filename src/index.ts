import { createLogger } from "./logger.js";
const log = createLogger("startup");

log.info("Loading index.ts...");
import "dotenv/config";
log.info("dotenv loaded");
import { Bot } from "grammy";
log.info("grammy loaded");
import { getSession, clearSession } from "./sessions.js";
log.info("sessions loaded");
import { loadMemories, createMemoryTools, loadTone, createToneTools } from "./memory.js";
log.info("memory loaded");
import { createCronTools, initCrons } from "./cron.js";
log.info("cron loaded");
import { loadPlugins } from "./plugins.js";
log.info("plugins loaded");
import { runAgent, runCronPrompt, setModel, getModelInfo } from "./agent.js";
log.info("agent loaded");
import type { Message } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";

log.info("All imports complete");
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required in .env");

const ALLOWED_USER_IDS = new Set(
  (process.env.ALLOWED_USER_IDS || "")
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id))
);

const bot = new Bot(BOT_TOKEN);

// Load plugins at startup
let pluginTools: AgentTool[] = [];

const SYSTEM_PROMPT_TEMPLATE = `You are a helpful personal assistant on Telegram. You can run code,
read/write files, search the web, and manage scheduled tasks on this machine.

{tone}

## Memory
When the user tells you something worth remembering (preferences, facts,
important info), use save_memory. Don't save trivial conversation.
Their saved memories are below.

## Tools
- read/write/edit/bash: interact with the local filesystem and run commands
- save_memory/recall_memories: persist info across conversations
- web_search: search the internet for current info
- fetch_url: fetch content from any URL (web pages, APIs, etc.)
- create_cron/list_crons/delete_cron: schedule recurring tasks

Be concise — this is a chat app, not an essay.

## User's Memories
{memories}`;

// Auth middleware
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !ALLOWED_USER_IDS.has(userId)) {
    await ctx.reply("Unauthorized.");
    return;
  }
  await next();
});

// /clear command
bot.command("clear", async (ctx) => {
  clearSession(ctx.from!.id);
  await ctx.reply("Session cleared.");
});

// /model command
bot.command("model", async (ctx) => {
  const parts = ctx.message?.text?.split(/\s+/).slice(1) || [];
  if (parts.length < 2) {
    const info = getModelInfo();
    await ctx.reply(`Current: ${info.provider}/${info.modelId}\nUsage: /model <provider> <model_id>`);
    return;
  }
  setModel(parts[0], parts[1]);
  await ctx.reply(`Model set to ${parts[0]}/${parts[1]}`);
});

// Create a logger for message handling
const msgLog = createLogger("msg");

// Main message handler
bot.on("message:text", async (ctx) => {
  const userId = ctx.from!.id;
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  msgLog.info(`Received from user ${userId} in chat ${chatId}: "${text.substring(0, 100)}..."`);

  await ctx.api.sendChatAction(chatId, "typing");
  msgLog.debug(`Typing indicator sent to chat ${chatId}`);

  const session = getSession(userId);
  const memories = loadMemories(userId);
  const tone = loadTone();
  const toneSection = tone 
    ? `## Tone and Identity\n${tone}`
    : `## Tone and Identity\nYour tone has not been set yet. Ask the user: "Who am I and what tone should I use?" Once they answer, use the set_tone tool to save their preferences.`;
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE
    .replace("{tone}", toneSection)
    .replace("{memories}", memories || "(none)");

  // Add user message to session
  const userMsg: Message = {
    role: "user",
    content: text,
    timestamp: Date.now(),
  };
  session.messages.push(userMsg);

  // Collect all custom tools
  const memoryTools = createMemoryTools(userId);
  const cronTools = createCronTools(chatId, bot.api, (prompt, cid) =>
    runCronPrompt(prompt, [...pluginTools, ...createMemoryTools(userId)])
  );
  const toneTools = createToneTools();
  const allCustomTools: AgentTool[] = [
    ...memoryTools,
    ...cronTools,
    ...toneTools,
    ...pluginTools,
  ];

  try {
    msgLog.info(`Starting agent for user ${userId}, messages: ${session.messages.length}, tools: ${allCustomTools.length}`);

    const response = await runAgent(
      session.messages,
      systemPrompt,
      allCustomTools
    );

    msgLog.info(`Agent response for user ${userId}, length: ${response?.length || 0}`);
    msgLog.debug(`Response preview: "${response?.substring(0, 100) || '(empty)'}..."`);

    // Add assistant response to session
    const assistantMsg: Message = {
      role: "assistant",
      content: [{ type: "text", text: response }],
      api: "anthropic" as any,
      provider: "anthropic" as any,
      model: getModelInfo().modelId,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    };
    session.messages.push(assistantMsg);

    // Split long messages
    if (response.length <= 4096) {
      msgLog.debug(`Sending single message to user ${userId}`);
      await ctx.reply(response);
      msgLog.info(`Reply sent to user ${userId}`);
    } else {
      const chunks = Math.ceil(response.length / 4096);
      msgLog.info(`Sending ${chunks} chunks to user ${userId}`);
      for (let i = 0; i < response.length; i += 4096) {
        await ctx.reply(response.slice(i, i + 4096));
        msgLog.debug(`Chunk ${Math.floor(i / 4096) + 1}/${chunks} sent`);
      }
    }
  } catch (err: any) {
    msgLog.error(`Error for user ${userId}: ${err.message}`);
    msgLog.error(`Stack trace: ${err.stack}`);
    await ctx.reply(`Error: ${err.message}`);
  }
});

// Start bot
async function main() {
  log.info("Starting bot initialization...");

  log.info("Loading plugins...");
  pluginTools = await loadPlugins();
  log.info(`Loaded ${pluginTools.length} plugin tools`);

  log.info("Initializing crons...");
  initCrons(bot.api, (prompt, chatId) =>
    runCronPrompt(prompt, [...pluginTools])
  );
  log.info("Crons initialized");

  log.info("Starting bot...");
  bot.start();
  log.info("Bot started successfully! 🚀");
}

log.info("Executing main()...");
main().catch((err) => {
  log.error(`Startup error: ${err.message}`);
  log.error(`Stack: ${err.stack}`);
});
