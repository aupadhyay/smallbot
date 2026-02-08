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
import type { Message, TextContent, ImageContent } from "@mariozechner/pi-ai";
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

// Supported image MIME types for vision models
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
]);

// Supported document MIME types
const SUPPORTED_DOC_TYPES = new Set([
  "application/pdf",
]);

/**
 * Download a file from Telegram's servers and return it as a base64 string.
 */
async function downloadTelegramFile(fileId: string): Promise<{ data: string; mimeType: string }> {
  const file = await bot.api.getFile(fileId);
  const filePath = file.file_path!;
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  const data = buffer.toString("base64");

  // Infer MIME type from file extension if not provided
  const ext = filePath.split(".").pop()?.toLowerCase();
  const extToMime: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
  };
  const mimeType = extToMime[ext || ""] || "application/octet-stream";

  return { data, mimeType };
}

/**
 * Core message handler — processes text + optional attachments and sends to the model.
 */
async function handleMessage(
  ctx: any,
  text: string | undefined,
  attachments: { fileId: string; mimeType?: string; fileName?: string }[]
) {
  const userId = ctx.from!.id;
  const chatId = ctx.chat.id;

  msgLog.info(`Received from user ${userId} in chat ${chatId}: text="${(text || "").substring(0, 100)}", attachments=${attachments.length}`);

  // Send typing indicator repeatedly until we respond
  // Telegram's typing indicator expires after ~5 seconds
  const sendTyping = () => ctx.api.sendChatAction(chatId, "typing").catch(() => {});
  await sendTyping();
  const typingInterval = setInterval(sendTyping, 4000);
  msgLog.debug(`Typing indicator started for chat ${chatId}`);

  const stopTyping = () => {
    clearInterval(typingInterval);
    msgLog.debug(`Typing indicator stopped for chat ${chatId}`);
  };

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

  // Build user message content
  let content: string | (TextContent | ImageContent)[];

  if (attachments.length === 0) {
    // Plain text message
    content = text || "";
  } else {
    // Multi-part content: text + attachments
    const parts: (TextContent | ImageContent)[] = [];

    if (text) {
      parts.push({ type: "text", text });
    }

    for (const att of attachments) {
      try {
        msgLog.info(`Downloading attachment: ${att.fileName || att.fileId} (${att.mimeType || "unknown"})`);
        const { data, mimeType } = await downloadTelegramFile(att.fileId);
        const resolvedMime = att.mimeType || mimeType;
        msgLog.info(`Downloaded ${att.fileName || att.fileId}: ${resolvedMime}, ${Math.round(data.length / 1024)}KB base64`);
        parts.push({ type: "image", data, mimeType: resolvedMime });
      } catch (err: any) {
        msgLog.error(`Failed to download attachment: ${err.message}`);
        const isTooBig = err.message?.includes("file is too big");
        const name = att.fileName || "the file";
        if (isTooBig) {
          parts.push({ type: "text", text:
            `[The user attached "${name}" (${att.mimeType || "unknown type"}) but it exceeds Telegram's 20MB bot download limit. ` +
            `Suggest they share a link/URL to the file instead — you can use the fetch_url tool to retrieve it.]`
          });
        } else {
          parts.push({ type: "text", text: `[Failed to load attachment "${name}": ${err.message}]` });
        }
      }
    }

    if (parts.length === 0) {
      parts.push({ type: "text", text: text || "" });
    }

    content = parts;
  }

  // Add user message to session
  const userMsg: Message = {
    role: "user",
    content,
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
      stopTyping(); // Stop typing once we have a message to edit
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
      stopTyping(); // Stop typing once we have a response

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
    stopTyping(); // Clean up typing interval on error
    msgLog.error(`Error for user ${userId}: ${err.message}`);
    msgLog.error(`Stack trace: ${err.stack}`);
    await ctx.reply(`Error: ${err.message}`);
  }
}

// Text-only messages
bot.on("message:text", async (ctx) => {
  await handleMessage(ctx, ctx.message.text, []);
});

// Photo messages (images sent directly or as compressed photos)
bot.on("message:photo", async (ctx) => {
  // Telegram provides multiple sizes; pick the largest (last in array)
  const photos = ctx.message.photo;
  const largest = photos[photos.length - 1];
  const caption = ctx.message.caption || undefined;

  await handleMessage(ctx, caption, [
    { fileId: largest.file_id, mimeType: "image/jpeg" }, // Telegram always converts photos to JPEG
  ]);
});

// Document messages (PDFs, high-res images sent as files, etc.)
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const caption = ctx.message.caption || undefined;
  const mimeType = doc.mime_type || "application/octet-stream";

  // Check if this is a supported file type
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType) && !SUPPORTED_DOC_TYPES.has(mimeType)) {
    await ctx.reply(
      `Unsupported file type: ${mimeType}\n` +
      `Supported: images (JPEG, PNG, GIF, WebP) and PDFs.`
    );
    return;
  }

  await handleMessage(ctx, caption, [
    { fileId: doc.file_id, mimeType, fileName: doc.file_name || undefined },
  ]);
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
