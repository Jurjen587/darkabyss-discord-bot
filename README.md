# DarkAbyss Discord Bot

Always-online Discord presence bot for darkabyss.nl. Keeps the bot online continuously and optionally displays live Nitrado game server player counts in the bot's status.

## Requirements

- Node.js 16.x
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

### Environment variables

```env
# Required
DISCORD_BOT_TOKEN=your_bot_token_here

# Optional presence settings
DISCORD_BOT_STATUS=online
DISCORD_BOT_ACTIVITY_TYPE=Watching
DISCORD_BOT_ACTIVITY_TEXT=darkabyss.nl

# Optional: Nitrado player count (supports dual accounts + multiple service IDs)
NITRADO_1_API_TOKEN=your_first_nitrado_api_token
NITRADO_1_SERVICE_IDS=12030,12002
NITRADO_2_API_TOKEN=your_second_nitrado_api_token
NITRADO_2_SERVICE_IDS=12040,12021
NITRADO_API_BASE_URL=https://api.nitrado.net
NITRADO_POLL_SECONDS=120
```

When Nitrado tokens are set, the bot polls all configured service IDs across both accounts, sums all player counts, and displays them in the activity text:

> `darkabyss.nl | 24 players online`

If all polls fail, it falls back to the base `DISCORD_BOT_ACTIVITY_TEXT`.

## Running

### Locally

```bash
npm start
```

### Permanently with PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

After changing `.env`, restart the process to reload env:

```bash
pm2 restart darkabyss-discord-bot
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs darkabyss-discord-bot
pm2 restart darkabyss-discord-bot
pm2 stop darkabyss-discord-bot
```

## Discord Bot Setup

1. In the [Discord Developer Portal](https://discord.com/developers/applications), open your app and go to the **Bot** tab.
2. Copy the bot token into `DISCORD_BOT_TOKEN` in `.env`.
3. Invite the bot to your server with the **Send Messages** permission.

## Security

Regenerate your Discord bot token if it has ever been shared, then update `.env` with the new token.

If this bot shares a token with a Laravel app (e.g. darkabyss), also update `DISCORD_BOT_TOKEN` in the Laravel `.env` and run:

```bash
php artisan config:clear
```
