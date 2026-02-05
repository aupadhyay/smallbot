# smallbot

Moltbot, but smaller and less complex. Only supports Telegram.

**Features**
- **Chat**: talk to it like any AI assistant
- **Run code & commands**: shell/filesystem access on the host machine, be careful
- **Web search**: uses Brave for current info (same as Claude)
- **Memory**: remembers things you tell it across conversations
- **Cron jobs**: schedule recurring AI tasks (e.g. "every morning at 9am, do something useful") 

**Commands**
- `/clear`: start new conversation
- `/model <provider> <model_id>`: switch models

## Setup
1. Copy `.env` and fill in your values:

```
BOT_TOKEN=your-telegram-bot-token
ALLOWED_USER_IDS=123456789
ANTHROPIC_API_KEY=sk-ant-...
MODEL_PROVIDER=anthropic
MODEL_ID=claude-sonnet-4-5-20250514
```

- `BOT_TOKEN`: get one from [@BotFather](https://t.me/BotFather)
- `ALLOWED_USER_IDS`: comma-separated Telegram user IDs that can use the bot (message [@JsonDumpBot](https://t.me/JsonDumpBot) to get your user ID)
- `MODEL_PROVIDER`: default AI provider to use (e.g. "anthropic")
- `MODEL_ID`: default model to use (e.g. "claude-sonnet-4-5-20250514")

2. Update `smallbot.yaml` (optional):

```yaml
streaming: true
timezone: America/New_York
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `streaming` | boolean | `true` | Stream responses as they come in |
| `timezone` | string | `"UTC"` | Timezone for cron jobs. Uses [IANA timezone names](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones). |

3. Run it:
```bash
pnpm install
pnpm start
```

## Plugins

Drop a plugin in the `plugins/` folder and restart. There's an example template at `plugins/_example.ts`. Basically you export a `tool` object and a `handler` function and that's it.

Files starting with `_` are ignored by the loader.

## Structure

```
src/
  index.ts      - bot setup, auth, message handling
  agent.ts      - AI agent loop (streaming + tool execution)
  sessions.ts   - per-user conversation sessions
  memory.ts     - persistent memory (save/recall)
  cron.ts       - scheduled tasks with node-cron
  plugins.ts    - plugin loader
  config.ts     - yaml config loader
  prompts.ts    - prompt template loader
  logger.ts     - logging utility
plugins/
  web-search.ts - Brave Search plugin
  fetch-url.ts  - URL fetching plugin
  _example.ts   - plugin template
smallbot.yaml   - bot config
prompts.yaml    - system prompts
```
