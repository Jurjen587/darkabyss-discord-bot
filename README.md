# DarkAbyss Discord Bot

Full-featured Discord bot for the DarkAbyss ARK server community. Manages server status, in-game economy, player tracking, moderation tools, cross-chat relay, and more — all powered by a Laravel API backend.

## Requirements

- Node.js 16.x
- A Discord bot token ([Discord Developer Portal](https://discord.com/developers/applications))
- DarkAbyss Laravel backend (for server management, economy, tracking, and moderation features)

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

3. Enable the **Message Content Intent** in the [Discord Developer Portal](https://discord.com/developers/applications) → your app → Bot tab, then set `DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=true` in `.env`.

4. Run Laravel migrations on the backend to create the required database tables:

```bash
cd /path/to/darkabyss
php artisan migrate
```

5. Schedule the Laravel Artisan commands (add to crontab or Laravel scheduler):

```bash
# Run scheduled RCON commands (every minute)
php artisan rcon:run-scheduled

# Sync bans to all servers (every 5 minutes)
php artisan rcon:sync-bans

# Poll online players for session tracking (every minute)
php artisan rcon:poll-players
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DISCORD_BOT_TOKEN` | Discord bot authentication token | **Required** |
| `DISCORD_BOT_STATUS` | Presence status (`online`, `idle`, `dnd`, `invisible`) | `online` |
| `DISCORD_BOT_ACTIVITY_TYPE` | Activity type (`Playing`, `Watching`, `Listening`, `Streaming`, `Competing`) | `Watching` |
| `DISCORD_BOT_ACTIVITY_TEXT` | Activity text shown in presence | `darkabyss.nl` |
| `DISCORD_COMMAND_PREFIX` | Prefix for all text commands | `&` |
| `DISCORD_ENABLE_MESSAGE_CONTENT_INTENT` | Enable MESSAGE_CONTENT intent (must match Developer Portal setting) | `false` |
| `DISCORD_SHOP_API_URL` | Legacy Shop API URL (Laravel backend) | |
| `DISCORD_SHOP_API_TOKEN` | Legacy Shop API auth token | |
| `LARAVEL_API_URL` | Laravel API base URL (falls back to `DISCORD_SHOP_API_URL`) | |
| `LARAVEL_API_TOKEN` | Laravel API auth token (falls back to `DISCORD_SHOP_API_TOKEN`) | |
| `NITRADO_1_API_TOKEN` | Nitrado API token (account 1) | |
| `NITRADO_1_SERVICE_IDS` | Comma-separated Nitrado service IDs (account 1) | |
| `NITRADO_2_API_TOKEN` | Nitrado API token (account 2) | |
| `NITRADO_2_SERVICE_IDS` | Comma-separated Nitrado service IDs (account 2) | |
| `NITRADO_API_BASE_URL` | Nitrado API base URL | `https://api.nitrado.net` |
| `NITRADO_POLL_SECONDS` | Polling interval in seconds (min 30) | `120` |
| `STATUS_CHANNEL_ID` | Discord channel for auto-updating server status embed | |
| `BALANCE_STARTING_AMOUNT` | Starting balance for new users | `0` |
| `BALANCE_ADMIN_USER_IDS` | Comma-separated Discord user IDs with admin permissions | |

## Running

### Locally

```bash
npm start
```

### Production with PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

After changing `.env`, restart:

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

Or use the deploy script:

```bash
npm run deploy
```

---

## Commands Reference

All commands use the configurable prefix (default `&`). Admin = user ID in `BALANCE_ADMIN_USER_IDS` or has Discord ADMINISTRATOR permission.

### Balance & Credits

Local file-backed balance system (`data/balances.json`).

| Command | Syntax | Perms | Description |
|---------|--------|-------|-------------|
| bal | `&bal [@user]` | All | Show your or another user's balance |
| bal transfer | `&bal transfer @user <amount>` | All | Transfer credits to another user |
| bal set | `&bal set @user <amount>` | Admin | Set a user's balance |
| bal add | `&bal add @user <amount>` | Admin | Add to a user's balance |
| bal remove | `&bal remove @user <amount>` | Admin | Remove from a user's balance |
| baltop | `&baltop` | All | Top 10 balances |
| bal help | `&bal help` | All | Show help |

### ARK Shop

Interactive shop with Discord button navigation. Supports category browsing, pagination, and one-click buying.

| Command | Syntax | Perms | Description |
|---------|--------|-------|-------------|
| arkshop | `&arkshop` | All | Open the interactive shop browser |
| arkshop set eosid | `&arkshop set eosid <EOS_ID>` | All | Save your EOS ID for purchases |
| arkshop set specimen | `&arkshop set specimen <NAME>` | All | Save your character name |
| arkshop buy | `&arkshop buy <packageId> <EOSID> <SPECIMEN>` | All | Manual purchase |

### Lottery

| Command | Syntax | Perms | Description |
|---------|--------|-------|-------------|
| lottery info | `&lottery info` | All | Show active lottery and your pick |
| lottery signup | `&lottery signup <number>` | All | Pick a number |
| lottery start | `&lottery start <min> <max>` | Admin | Start a lottery with number range |
| lottery add | `&lottery add @user <number>` | Admin | Manually add a player entry |
| lottery roll | `&lottery roll` | Admin | Roll the winner |

### Random Number

| Command | Syntax | Perms | Description |
|---------|--------|-------|-------------|
| randomnumber | `&randomnumber <min> <max>` | Admin | Roll a random integer |

### Server Management

Requires Laravel API connection.

| Command | Syntax | Perms | Description |
|---------|--------|-------|-------------|
| servers | `&servers` | All | List all configured ARK servers |
| players | `&players [clusterId]` | All | Show online players grouped by server |
| rcon | `&rcon <serverId> <command>` | Admin | Execute RCON command on a server |
| broadcast | `&broadcast <clusterId> <command>` | Admin | Execute RCON on all servers in a cluster |
| ban | `&ban <clusterId> <playerId> [reason]` | Admin | Ban player across a cluster |
| unban | `&unban <banId>` | Admin | Remove a ban |
| bans | `&bans [clusterId]` | Admin | List active bans |
| schedule | `&schedule <serverId> "<cron>" <command>` | Admin | Create a scheduled RCON command |
| schedule list | `&schedule list` | Admin | List scheduled commands |
| schedule remove | `&schedule remove <id>` | Admin | Delete a scheduled command |

### Economy

Requires Laravel API connection.

| Command | Syntax | Perms | Description |
|---------|--------|-------|-------------|
| lootbox | `&lootbox` | All | List available lootboxes |
| lootbox open | `&lootbox open <id>` | All | Open a lootbox (costs credits) |
| transactions | `&txn` | All | Show your last 10 transactions |
| payday | `&payday` | All | Claim periodic free credits |
| discounts | `&discounts` | All | Show active role & daily discounts |
| discount role | `&discount role <roleId> <percent>` | Admin | Set discount for a Discord role |
| discount daily | `&discount daily <day 0-6> <percent> [label]` | Admin | Set daily discount (0=Sun) |
| price | `&price <packageId>` | All | Check final price with your discounts |

### Tracking & Leaderboards

Requires Laravel API connection.

| Command | Syntax | Perms | Description |
|---------|--------|-------|-------------|
| stats | `&stats <eosId>` | All | Player stats (kills, deaths, K/D, tames, playtime) |
| leaderboard | `&lb <type> [limit]` | All | Leaderboard: `playtime`, `kills`, `deaths`, `tames`, `kd` |
| killfeed | `&kf [limit]` | All | Recent PvP kills (with bob-kill detection) |
| level | `&level [@user]` | All | Discord XP level, messages, stars, prestige |
| star | `&star @user` | All | Give a star to someone |
| discordlb | `&dlb [type]` | All | Discord leaderboard: `xp`, `messages`, `stars` |
| weeklylb | `&wlb` | All | Weekly XP/message leaderboard |
| timeline | `&timeline <eosId> [days]` | Admin | Player session history |
| lookback | `&lookback <eosId> <datetime>` | Admin | Was player online at a specific time? |
| whowason | `&whowason <datetime> [serverId]` | Admin | Who was online at a specific time? |

### Moderation & Investigation

Requires Laravel API connection.

| Command | Syntax | Perms | Description |
|---------|--------|-------|-------------|
| watchlist | `&watchlist` | Admin | Show player watchlist |
| watchlist add | `&watchlist add <eosId> [reason]` | Admin | Add to watchlist |
| tribelog | `&tribelog <serverId> [limit]` | Admin | View recent tribe logs |
| tribesub | `&tribesub <serverId> <tribeName>` | Admin | Subscribe channel to tribe alerts |
| hunt | `&hunt <serverId> <dinoName>` | Admin | Find wild dinos on a server |
| findtame | `&findtame <serverId> <query>` | Admin | Find tamed dinos |
| territory | `&territory <serverId> <tribeName>` | Admin | Show tribe territory |
| findstructure | `&findstructure <serverId> <query>` | Admin | Find structures |
| foreigntames | `&foreigntames <serverId>` | Admin | Detect foreign/transferred tames |
| massbreed | `&massbreed <serverId>` | Admin | Detect mass-breeding |
| tamestat | `&tamestat <serverId>` | Admin | Check for suspicious tame stats |
| uncryo | `&uncryo <serverId>` | Admin | Check uncryo limits |
| playtimeroles | `&playtimeroles` | Admin | List playtime-based role assignments |

### Player Commands

| Command | Syntax | Perms | Description |
|---------|--------|-------|-------------|
| starterkit | `&starterkit <clusterId>` | All | Claim a starter kit (once per cluster) |
| imstuck | `&imstuck <serverId>` | All | Unstick your character |

---

## Features

### Live Server Status

When `STATUS_CHANNEL_ID` is set, the bot posts a persistent embed showing each server's status, player count, and map. It auto-updates on each Nitrado poll cycle. Color-coded: green (all up), orange (partial), red (all down).

### Nitrado Player Count

When Nitrado accounts are configured, the bot polls all service IDs, sums the player counts, and shows:

> `darkabyss.nl | 24 players online`

### Cross-Chat Relay

Bridges game chat and Discord channels bidirectionally:

- **Game → Discord**: Polls servers every 10 seconds, posts new messages as embeds
- **Discord → Game**: Messages in bridged channels are broadcast to all servers in the cluster
- **Cross-server**: Chat relays between servers within the same cluster

Configure bridge channels via the Laravel API (`chat_bridge_configs` table).

### XP & Leveling System

Every non-command message earns random XP (15-25, with 60s cooldown). Level-ups are announced in the channel. Tracks level, XP, total messages, stars received, and prestige.

### Lootbox System

Lootboxes contain items with weighted rarity drops (common, uncommon, rare, epic, legendary). Opening costs credits. Items are delivered in-game.

### Discount System

Two types of discounts stack:
- **Role discounts**: Percentage off for users with specific Discord roles
- **Daily discounts**: Percentage off on specific days of the week

The `&price` command shows the best available discount for a user.

### Ban Sync

Bans a player by EOS ID and automatically syncs the ban via RCON to all servers in a cluster. Managed via scheduled Laravel artisan command.

### Scheduled RCON Commands

Create cron-scheduled RCON commands that run automatically (e.g., server messages, periodic wipes). Managed via the `rcon:run-scheduled` artisan command.

### Player Session Tracking

Tracks when players join/leave servers. Enables:
- **Timeline**: Full session history for a player
- **Lookback**: Check if a specific player was online at a given time
- **Who Was On**: List all players online at a given time
- **Playtime Roles**: Auto-assign Discord roles based on cumulative playtime

### Watchlist

Track suspicious players. When a watchlisted player joins a server (detected via `rcon:poll-players`), alerts are generated.

### Investigation Tools

Admin RCON-based tools for server investigation:
- Hunt wild dinos, find tamed dinos, view tribe territory, find structures
- Detect foreign tames, mass breeding, suspicious stats, uncryo violations

---

## Architecture

```
Discord Bot (Node.js)
    │
    ├── Text Commands (prefix-based)
    ├── Button Interactions (arkshop)
    ├── Passive XP Tracking (on every message)
    ├── Cross-Chat Relay (10s polling)
    └── Nitrado Polling (configurable interval)
            │
            ▼
    Laravel API (darkabyss)
    ├── /api/discord/servers/*     → Server management, RCON, bans, chat
    ├── /api/discord/economy/*     → Lootboxes, transactions, discounts, payday
    ├── /api/discord/tracking/*    → Stats, leaderboards, kills, levels, sessions
    ├── /api/discord/moderation/*  → Watchlist, tribelogs, investigation, starter kits
    └── /api/discord/shop/*        → ARK Shop packages, orders, categories
            │
            ▼
    ARK Servers (RCON)
```

All API requests use `X-Discord-Shop-Token` header authentication. The API client (`lib/apiClient.js`) auto-retries on 429 rate limit responses.

## Discord Bot Setup

1. In the [Discord Developer Portal](https://discord.com/developers/applications), open your app → **Bot** tab.
2. Enable **Message Content Intent** under Privileged Gateway Intents.
3. Copy the bot token into `DISCORD_BOT_TOKEN` in `.env`.
4. Invite the bot to your server with the **Send Messages**, **Embed Links**, and **Read Message History** permissions.

## Security

- Regenerate your Discord bot token if it has ever been shared, then update `.env`.
- The `LARAVEL_API_TOKEN` / `DISCORD_SHOP_API_TOKEN` must match the `DISCORD_SHOP_API_TOKEN` in your Laravel `.env`.
- All admin commands require explicit user ID allowlisting or Discord ADMINISTRATOR permission.
- RCON passwords are stored server-side in Laravel only — the bot never handles them directly.
