# smallbot

Moltbot, but smaller and more readable. Only supports Telegram.

It can run code, read/write files, search the web, remember things about you, and run scheduled tasks.

**Features**
- **Chat** -- talk to it like any AI assistant
- **Run code & commands** -- it has full shell/filesystem access on the host machine
- **Web search** -- uses Brave Search for current info (same as Claude)
- **Memory** -- remembers things you tell it across conversations
- **Cron jobs** -- schedule recurring AI tasks (e.g. "every morning at 9am, check the weather and message me")

**Commands**
- `/clear` -- start new conversation
- `/model <provider> <model_id>` -- switch models

## Setup

1. Clone it and install deps:

```
pnpm install
```

2. Copy `.env` and fill in your values:

```
BOT_TOKEN=your-telegram-bot-token
ALLOWED_USER_IDS=123456789
ANTHROPIC_API_KEY=sk-ant-...
MODEL_PROVIDER=anthropic
MODEL_ID=claude-sonnet-4-5-20250514
```

- `BOT_TOKEN` -- get one from [@BotFather](https://t.me/BotFather)
- `ALLOWED_USER_IDS` -- comma-separated Telegram user IDs that can use the bot
- You need at least one AI provider API key (Anthropic, OpenAI, Google, etc.)

3. Run it:

```
pnpm start
```

## Plugins

Drop a `.ts` file in the `plugins/` folder and restart. There's an example template at `plugins/_example.ts` -- basically you export a `tool` object and a `handler` function and that's it.

Files starting with `_` are ignored by the loader.

## Structure

```
src/
  index.ts      -- bot setup, auth, message handling
  agent.ts      -- AI agent loop (streaming + tool execution)
  sessions.ts   -- per-user conversation sessions
  memory.ts     -- persistent memory (save/recall)
  cron.ts       -- scheduled tasks with cron expressions
  plugins.ts    -- plugin loader
plugins/
  _example.ts   -- plugin template
  web-search.ts -- DuckDuckGo search plugin
```
