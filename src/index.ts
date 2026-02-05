import { createLogger } from "./logger.js";
const log = createLogger("startup");

import "dotenv/config";
import { getConfig } from "./config.js";
import { Bot } from "grammy";
import { getSession, clearSession } from "./sessions.js";
import { loadMemories, createMemoryTools, loadTone, createToneTools } from "./memory.js";
import { createCronTools, initCrons } from "./cron.js";
import { loadPlugins } from "./plugins.js";
import { runAgent, runAgentStreaming, runCronPrompt, setModel, getModelInfo, type StreamEvent } from "./agent.js";
import { getPrompt } from "./prompts.js";
import type { Message } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required in .env");

const config = getConfig();
const { streaming } = config;

const ALLOWED_USER_IDS = new Set(
  (process.env.ALLOWED_USER_IDS || "")
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id))
);

const bot = new Bot(BOT_TOKEN);

// Load plugins at startup
let pluginTools: AgentTool[] = [];

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
  const { timezone } = getConfig();
  const systemPrompt = getPrompt("system")
    .replace("{tone}", toneSection)
    .replace("{memories}", memories || "(none)")
    .replace("{timezone}", timezone);

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
    let response: string;

    if (streaming) {
      // === STREAMING MODE ===
      msgLog.info(`Starting streaming agent for user ${userId}, messages: ${session.messages.length}, tools: ${allCustomTools.length}`);

      // Send initial placeholder message
      const sentMsg = await ctx.reply("...");
      const messageId = sentMsg.message_id;

      // Streaming state
      let lastEditTime = 0;
      let lastEditedText = "";
      const THROTTLE_MS = 500; // Telegram rate limit friendly
      const MIN_CHARS_CHANGE = 20; // Don't edit for tiny changes

      // Tool indicators
      const toolEmojis: Record<string, string> = {
        web_search: "🔍",
        fetch_url: "🌐",
        bash: "⚙️",
        read: "📖",
        write: "✏️",
        edit: "✏️",
        save_memory: "💾",
        recall_memories: "🧠",
        create_cron: "⏰",
        default: "🔧",
      };

      const editMessage = async (newText: string, force = false) => {
        const now = Date.now();
        const textChanged = newText !== lastEditedText;
        const significantChange = newText.length - lastEditedText.length >= MIN_CHARS_CHANGE;
        const throttleOk = now - lastEditTime >= THROTTLE_MS;

        if (textChanged && (force || (throttleOk && significantChange))) {
          try {
            // Truncate if over Telegram limit
            const displayText = newText.length > 4000 ? newText.slice(-4000) + "\n\n[...truncated]" : newText;
            await ctx.api.editMessageText(chatId, messageId, displayText || "...");
            lastEditTime = now;
            lastEditedText = newText;
          } catch (e: any) {
            // Ignore "message not modified" errors
            if (!e.message?.includes("not modified")) {
              msgLog.warn(`Edit failed: ${e.message}`);
            }
          }
        }
      };

      // Process streaming events
      let fullText = "";
      let currentToolIndicator = "";

      const streamGen = runAgentStreaming(session.messages, systemPrompt, allCustomTools);

      for await (const event of streamGen) {
        switch (event.type) {
          case "text_delta":
            fullText = event.accumulated;
            await editMessage(fullText + currentToolIndicator);
            break;

          case "tool_start":
            const emoji = toolEmojis[event.name] || toolEmojis.default;
            currentToolIndicator = `\n\n${emoji} _${event.name}_...`;
            await editMessage(fullText + currentToolIndicator, true);
            break;

          case "tool_end":
            currentToolIndicator = "";
            // Force an edit to clear the tool indicator
            if (fullText) await editMessage(fullText, true);
            break;

          case "done":
            fullText = event.fullText;
            break;
        }
      }

      // Final edit with complete response
      await editMessage(fullText, true);

      // If response is too long for a single message, send overflow as new messages
      if (fullText.length > 4096) {
        msgLog.info(`Response overflow: ${fullText.length} chars, sending as multiple messages`);
        // Delete the streaming message and send properly chunked
        try {
          await ctx.api.deleteMessage(chatId, messageId);
        } catch (e) {
          // Ignore deletion errors
        }
        for (let i = 0; i < fullText.length; i += 4096) {
          await ctx.reply(fullText.slice(i, i + 4096));
        }
      }

      response = fullText;
      msgLog.info(`Streaming complete for user ${userId}, final length: ${response.length}`);

    } else {
      // === NON-STREAMING MODE ===
      msgLog.info(`Starting agent for user ${userId}, messages: ${session.messages.length}, tools: ${allCustomTools.length}`);

      response = await runAgent(session.messages, systemPrompt, allCustomTools);

      msgLog.info(`Agent response for user ${userId}, length: ${response?.length || 0}`);
      msgLog.debug(`Response preview: "${response?.substring(0, 100) || '(empty)'}..."`);

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
    }

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
  log.info("Bot started successfully");
}

log.info("Executing main()...");
main().catch((err) => {
  log.error(`Startup error: ${err.message}`);
  log.error(`Stack: ${err.stack}`);
});
