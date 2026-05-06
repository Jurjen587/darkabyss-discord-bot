const path = require('path');
const https = require('https');
const dotenv = require('dotenv');
const { Client, Intents } = require('discord.js');
const { createBalanceCommandHandler } = require('./commands/balance');
const { createLotteryCommandHandler } = require('./commands/lottery');
const { createArkShopCommandHandler, createArkShopInteractionHandler } = require('./commands/arkshop');
const { createServerStatusHandler } = require('./commands/serverStatus');
const { createRandomNumberCommandHandler } = require('./commands/randomNumber');
const { createApiClient } = require('./lib/apiClient');
const { createCrossChatHandler } = require('./commands/crossChat');
const { createServerManagementHandler } = require('./commands/serverManagement');
const { createEconomyHandler } = require('./commands/economy');
const { createTrackingHandler, recordJoin, backfillJoins } = require('./commands/tracking');
const { createModerationHandler } = require('./commands/moderation');

dotenv.config({ path: path.join(__dirname, '.env') });

const token = (process.env.DISCORD_BOT_TOKEN || '').trim();
if (!token) {
	console.error('DISCORD_BOT_TOKEN is missing in discord-bot/.env');
	process.exit(1);
}

const status = (process.env.DISCORD_BOT_STATUS || 'online').toLowerCase();
const activityTypeRaw = (process.env.DISCORD_BOT_ACTIVITY_TYPE || 'Watching').toLowerCase();
const activityText = process.env.DISCORD_BOT_ACTIVITY_TEXT || 'darkabyss.nl';
const commandPrefix = ((process.env.DISCORD_COMMAND_PREFIX || '&').trim() || '&');
const discordShopApiUrl = (process.env.DISCORD_SHOP_API_URL || '').trim();
const discordShopApiToken = (process.env.DISCORD_SHOP_API_TOKEN || '').trim();
const statusChannelId = (process.env.STATUS_CHANNEL_ID || '').trim();
const levelUpChannelId = (process.env.LEVEL_UP_CHANNEL_ID || '').trim();
const dupeAlertChannelId = (process.env.DUPE_ALERT_CHANNEL_ID || '1501520067215622174').trim();
const dupePollSeconds = 10;
const dupeJoinWindowMs = 10 * 60 * 1000;
const dupeJoinThreshold = 3;
const dupeAlertCooldownMs = 5 * 60 * 1000;

const nitradoApiBaseUrl = (process.env.NITRADO_API_BASE_URL || 'https://api.nitrado.net').replace(/\/+$/, '');
const pollSecondsValue = Number.parseInt(process.env.NITRADO_POLL_SECONDS || '120', 10);
const nitradoPollSeconds = Number.isFinite(pollSecondsValue) ? Math.max(30, pollSecondsValue) : 120;
const enableMessageContentIntent = (process.env.DISCORD_ENABLE_MESSAGE_CONTENT_INTENT || 'false').toLowerCase() === 'true';
const balanceStartingAmountRaw = Number.parseFloat(process.env.BALANCE_STARTING_AMOUNT || '0');
const balanceStartingAmount = Number.isFinite(balanceStartingAmountRaw) ? Math.max(0, balanceStartingAmountRaw) : 0;
const adminUserIds = new Set(
	(process.env.BALANCE_ADMIN_USER_IDS || '')
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value !== '')
);
const handleBalanceCommand = createBalanceCommandHandler({
	commandPrefix,
	balanceStartingAmount,
	adminUserIds,
});
const handleLotteryCommand = createLotteryCommandHandler({
	commandPrefix,
	adminUserIds,
});
const handleArkShopCommand = createArkShopCommandHandler({
	commandPrefix,
	apiBaseUrl: discordShopApiUrl,
	apiToken: discordShopApiToken,
	adminUserIds,
});
const handleArkShopInteraction = createArkShopInteractionHandler({
	commandPrefix,
	apiBaseUrl: discordShopApiUrl,
	apiToken: discordShopApiToken,
	adminUserIds,
});
const handleRandomNumberCommand = createRandomNumberCommandHandler({
	commandPrefix,
	adminUserIds,
});

// --- Laravel API-backed feature handlers ---
// LARAVEL_API_URL should be the base origin (e.g. http://localhost).
// When falling back to DISCORD_SHOP_API_URL (which includes /api/discord/shop), strip the path.
const laravelApiToken = (process.env.LARAVEL_API_TOKEN || discordShopApiToken || '').trim();
let laravelApiUrl = (process.env.LARAVEL_API_URL || '').trim();
if (!laravelApiUrl && discordShopApiUrl) {
	try {
		const parsed = new URL(discordShopApiUrl);
		laravelApiUrl = parsed.origin;
	} catch {
		laravelApiUrl = discordShopApiUrl.replace(/\/api\/.*$/, '');
	}
}
const api = createApiClient({ baseUrl: laravelApiUrl, apiToken: laravelApiToken });

const serverManagementHandler = createServerManagementHandler({ commandPrefix, api, adminUserIds });
const economyHandler = createEconomyHandler({ commandPrefix, api, adminUserIds });
const trackingHandler = createTrackingHandler({ commandPrefix, api, adminUserIds, levelUpChannelId });
const moderationHandler = createModerationHandler({ commandPrefix, api, adminUserIds });

function parseServiceIds(rawServiceIds) {
  return (rawServiceIds || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
}

const nitradoAccounts = [
  {
    name: 'NITRADO_1',
    token: (process.env.NITRADO_1_API_TOKEN || '').trim(),
    serviceIds: parseServiceIds(process.env.NITRADO_1_SERVICE_IDS),
  },
  {
    name: 'NITRADO_2',
    token: (process.env.NITRADO_2_API_TOKEN || '').trim(),
    serviceIds: parseServiceIds(process.env.NITRADO_2_SERVICE_IDS),
  },
].filter((account) => account.token !== '' && account.serviceIds.length > 0);

const activityTypeMap = {
	playing: 'PLAYING',
	streaming: 'STREAMING',
	listening: 'LISTENING',
	watching: 'WATCHING',
	competing: 'COMPETING',
};

const activityType = activityTypeMap[activityTypeRaw] || 'PLAYING';

const optionalMessageContentIntent = Intents.FLAGS.MESSAGE_CONTENT;
const clientIntents = [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MEMBERS];
if (enableMessageContentIntent && optionalMessageContentIntent) {
	clientIntents.push(optionalMessageContentIntent);
}

const client = new Client({
	intents: clientIntents,
});

let lastPresenceText = '';
let pollTimer = null;
let dupePollTimer = null;

const dupeState = {
	previousOnlineKeys: new Set(),
	joinHistoryByPlayer: new Map(),
	lastAlertByPlayer: new Map(),
	initialized: false,
};

const serverStatusHandler = (statusChannelId && nitradoAccounts.length > 0)
	? createServerStatusHandler({ client, channelId: statusChannelId, nitradoAccounts, nitradoApiBaseUrl })
	: null;

function setPresence(text) {
	const nextText = (text || '').trim() || activityText;

	if (!client.user || nextText === lastPresenceText) {
		return;
	}

	client.user.setPresence({
		status: ['online', 'idle', 'dnd', 'invisible'].includes(status) ? status : 'online',
		activities: [{
			name: nextText,
			type: activityType,
		}],
	});

	lastPresenceText = nextText;
	console.log('Presence set: ' + activityTypeRaw + ' ' + nextText);
}

function fetchJson(url, headers) {
	return new Promise((resolve, reject) => {
		const request = https.get(url, { headers }, (response) => {
			const chunks = [];

			response.on('data', (chunk) => chunks.push(chunk));
			response.on('end', () => {
				const body = Buffer.concat(chunks).toString('utf8');

				if (response.statusCode < 200 || response.statusCode >= 300) {
					reject(new Error('Nitrado API HTTP ' + response.statusCode + ': ' + body.slice(0, 300)));
					return;
				}

				try {
					resolve(JSON.parse(body));
				} catch {
					reject(new Error('Nitrado API returned non-JSON response.'));
				}
			});
		});

		request.on('error', (error) => reject(error));
		request.setTimeout(10000, () => {
			request.destroy(new Error('Nitrado API request timed out.'));
		});
	});
}

function firstNumericValue(values) {
	for (const value of values) {
		const numeric = Number(value);
		if (Number.isFinite(numeric)) {
			return numeric;
		}
	}

	return null;
}

function extractPlayerCount(payload) {
	const candidates = [
		payload?.data?.gameserver?.query?.player_current,
		payload?.data?.gameserver?.query?.players,
		payload?.data?.gameserver?.players,
		payload?.data?.gameserver?.player_current,
		payload?.data?.service?.details?.player_current,
		payload?.data?.service?.details?.players,
		payload?.data?.query?.player_current,
		payload?.data?.query?.players,
	];

	const directValue = firstNumericValue(candidates);
	if (directValue !== null) {
		return directValue;
	}

	const playersList = payload?.data?.gameserver?.query?.player_list;
	if (Array.isArray(playersList)) {
		return playersList.length;
	}

	return null;
}

function trimRecentTimestamps(timestamps, nowMs) {
	if (!Array.isArray(timestamps) || timestamps.length === 0) {
		return [];
	}

	return timestamps.filter((value) => Number.isFinite(value) && nowMs - value <= dupeJoinWindowMs);
}

function getPlayerKey(player) {
	const candidates = [
		player?.eos_id,
		player?.player_id,
		player?.eosId,
		player?.steam_id,
		player?.id,
		player?.name,
	];

	for (const value of candidates) {
		if (typeof value === 'string' && value.trim() !== '') {
			return value.trim().toLowerCase();
		}
		if (typeof value === 'number' && Number.isFinite(value)) {
			return String(value);
		}
	}

	return null;
}

function getPlayerDisplayName(player) {
	const candidates = [
		player?.name,
		player?.player_name,
		player?.character_name,
		player?.eos_id,
		player?.player_id,
	];

	for (const value of candidates) {
		if (typeof value === 'string' && value.trim() !== '') {
			return value.trim();
		}
	}

	return 'Unknown player';
}

function getPlayerServerName(player) {
	const candidates = [
		player?.server_name,
		player?.server,
		player?.map_name,
	];

	for (const value of candidates) {
		if (typeof value === 'string' && value.trim() !== '') {
			return value.trim();
		}
	}

	return 'Unknown server';
}

async function sendDupeAlert(alertData) {
	if (!dupeAlertChannelId) {
		return;
	}

	try {
		const channel = await client.channels.fetch(dupeAlertChannelId);
		if (!channel || typeof channel.send !== 'function') {
			console.error('Dupe alert channel is not a text channel: ' + dupeAlertChannelId);
			return;
		}

		const description = [
			'Player **' + alertData.name + '** has rejoined **' + alertData.joinCount + '** times in the last **10 minutes**.',
			'Server: **' + alertData.serverName + '**',
			'Player ID: `' + alertData.playerKey + '`',
			'Latest rejoin: <t:' + Math.floor(alertData.lastJoinMs / 1000) + ':R>',
		].join('\n');

		await channel.send({
			embeds: [{
				color: 0xe74c3c,
				title: 'Dupe Detector Alert',
				description,
				timestamp: new Date(alertData.lastJoinMs).toISOString(),
			}],
		});
	} catch (error) {
		console.error('Failed to send dupe alert:', error.message || error);
	}
}

async function pollDupeDetector() {
	if (!api) {
		return;
	}

	const nowMs = Date.now();
	const response = await api.listAllPlayers(null);
	const players = Array.isArray(response?.players) ? response.players : [];

	const onlineByKey = new Map();
	for (const player of players) {
		const key = getPlayerKey(player);
		if (!key || onlineByKey.has(key)) {
			continue;
		}
		onlineByKey.set(key, player);
	}

	const currentOnlineKeys = new Set(onlineByKey.keys());

	if (!dupeState.initialized) {
		dupeState.previousOnlineKeys = currentOnlineKeys;
		dupeState.initialized = true;
		return;
	}

	for (const [playerKey, player] of onlineByKey) {
		if (dupeState.previousOnlineKeys.has(playerKey)) {
			continue;
		}

		const history = trimRecentTimestamps(dupeState.joinHistoryByPlayer.get(playerKey), nowMs);
		history.push(nowMs);
		dupeState.joinHistoryByPlayer.set(playerKey, history);

		if (history.length < dupeJoinThreshold) {
			continue;
		}

		const lastAlertMs = dupeState.lastAlertByPlayer.get(playerKey) || 0;
		if (nowMs - lastAlertMs < dupeAlertCooldownMs) {
			continue;
		}

		dupeState.lastAlertByPlayer.set(playerKey, nowMs);
		await sendDupeAlert({
			playerKey,
			name: getPlayerDisplayName(player),
			serverName: getPlayerServerName(player),
			joinCount: history.length,
			lastJoinMs: nowMs,
		});
	}

	dupeState.previousOnlineKeys = currentOnlineKeys;
}

async function fetchNitradoPlayerCount(tokenValue, serviceId) {
  const url = nitradoApiBaseUrl + '/services/' + serviceId + '/gameservers';
  const payload = await fetchJson(url, {
    Authorization: 'Bearer ' + tokenValue,
    Accept: 'application/json',
  });

  const playerCount = extractPlayerCount(payload);

  if (playerCount === null) {
    throw new Error('Could not read player count from Nitrado response for service ' + serviceId + '.');
  }

  return playerCount;
}

async function updatePresenceFromNitrado() {
  let totalPlayers = 0;
  let successCount = 0;

  for (const account of nitradoAccounts) {
    for (const serviceId of account.serviceIds) {
      try {
        const servicePlayers = await fetchNitradoPlayerCount(account.token, serviceId);
        totalPlayers += servicePlayers;
        successCount += 1;
      } catch (error) {
        console.error('Nitrado poll failed (' + account.name + ', service ' + serviceId + '):', error.message || error);
      }
    }
  }

  if (successCount === 0) {
    throw new Error('All Nitrado service polls failed.');
  }

  setPresence(activityText + ' | ' + totalPlayers + ' players online');
}

client.once('ready', async () => {
	console.log('Logged in as ' + client.user.tag);
	if (!enableMessageContentIntent) {
		console.log('Message content intent is disabled. Set DISCORD_ENABLE_MESSAGE_CONTENT_INTENT=true to enable ' + commandPrefix + 'bal text commands.');
	}
	console.log('Command prefix: ' + commandPrefix);
	setPresence(activityText);

	// Backfill member join data from all guilds
	for (const [, guild] of client.guilds.cache) {
		guild.members.fetch().then((members) => {
			const added = backfillJoins(members);
			if (added > 0) console.log('Backfilled ' + added + ' member joins from ' + guild.name);
		}).catch((err) => {
			console.error('Failed to backfill members from ' + guild.name + ':', err.message || err);
		});
	}

	// Start cross-chat relay if API is configured
	if (api) {
		const handler = createCrossChatHandler({ api, client });
		if (handler) {
			handler.start();
			client.on('messageCreate', (msg) => {
				handler.handleMessage(msg).catch(() => {});
			});
			console.log('Cross-chat relay started.');
		}
	} else {
		console.log('Laravel API not configured. Set LARAVEL_API_URL and LARAVEL_API_TOKEN to enable new features.');
	}

	if (nitradoAccounts.length > 0) {
		const totalServices = nitradoAccounts.reduce((sum, account) => sum + account.serviceIds.length, 0);
		console.log('Nitrado player count polling enabled: ' + nitradoAccounts.length + ' account(s), ' + totalServices + ' service(s), every ' + nitradoPollSeconds + 's');

		try {
			await updatePresenceFromNitrado();
		} catch (error) {
			console.error('Initial Nitrado poll failed:', error.message || error);
			setPresence(activityText);
		}

		if (serverStatusHandler) {
			console.log('Server status embed enabled: channel ' + statusChannelId + ', updating every ' + nitradoPollSeconds + 's');
			serverStatusHandler.update().catch((error) => {
				console.error('Initial server status update failed:', error.message || error);
			});
		}

		pollTimer = setInterval(() => {
			updatePresenceFromNitrado().catch((error) => {
				console.error('Nitrado poll cycle failed:', error.message || error);
				setPresence(activityText);
			});
			if (serverStatusHandler) {
				serverStatusHandler.update().catch((error) => {
					console.error('Server status update failed:', error.message || error);
				});
			}
		}, nitradoPollSeconds * 1000);
	} else {
		console.log('Nitrado polling disabled. Set NITRADO_1_API_TOKEN/NITRADO_1_SERVICE_IDS and NITRADO_2_API_TOKEN/NITRADO_2_SERVICE_IDS to enable it.');
	}

	if (api) {
		console.log('Dupe detector enabled: polling online players every ' + dupePollSeconds + 's, alerts to channel ' + dupeAlertChannelId);
		pollDupeDetector().catch((error) => {
			console.error('Initial dupe detector poll failed:', error.message || error);
		});

		dupePollTimer = setInterval(() => {
			pollDupeDetector().catch((error) => {
				console.error('Dupe detector poll failed:', error.message || error);
			});
		}, dupePollSeconds * 1000);
	} else {
		console.log('Dupe detector disabled because Laravel API is not configured.');
	}
});

client.on('messageCreate', (message) => {
	if (!message || !message.author || message.author.bot) {
		return;
	}

	handleBalanceCommand(message).catch((error) => {
		console.error('Balance command failed:', error.message || error);
		message.reply('Something went wrong while processing that command.').catch(() => {});
	});

	handleLotteryCommand(message).catch((error) => {
		console.error('Lottery command failed:', error.message || error);
		message.reply('Something went wrong while processing that lottery command.').catch(() => {});
	});

	handleArkShopCommand(message).catch((error) => {
		console.error('Arkshop command failed:', error.message || error);
		message.reply('Something went wrong while processing that arkshop command.').catch(() => {});
	});

	handleRandomNumberCommand(message).catch((error) => {
		console.error('Random number command failed:', error.message || error);
		message.reply('Something went wrong with the random number command.').catch(() => {});
	});

	// New API-backed command handlers
	if (serverManagementHandler) {
		serverManagementHandler(message).catch((error) => {
			console.error('Server management command failed:', error.message || error);
		});
	}
	if (economyHandler) {
		economyHandler(message).catch((error) => {
			console.error('Economy command failed:', error.message || error);
		});
	}
	if (trackingHandler) {
		trackingHandler.handleMessage(message).catch((error) => {
			console.error('Tracking command failed:', error.message || error);
		});
		// XP tracking on every message (non-command)
		trackingHandler.handleActivity(message).catch((error) => {
			console.error('Activity tracking failed:', error.message || error);
		});
	}
	if (moderationHandler) {
		moderationHandler.handleMessage(message).catch((error) => {
			console.error('Moderation command failed:', error.message || error);
		});
	}
});

client.on('interactionCreate', (interaction) => {
	handleArkShopInteraction(interaction).catch((error) => {
		console.error('Arkshop interaction failed:', error.message || error);
	});
});

client.on('guildMemberAdd', (member) => {
	if (member.user.bot) return;
	recordJoin(member.user.id, member.user.tag, member.joinedTimestamp || Date.now());
});

client.on('error', (error) => {
	console.error('Discord client error:', error.message);
});

process.on('unhandledRejection', (error) => {
	console.error('Unhandled promise rejection:', error);
});

process.on('SIGINT', async () => {
	console.log('Shutting down Discord bot...');
	if (pollTimer) {
		clearInterval(pollTimer);
	}
	if (dupePollTimer) {
		clearInterval(dupePollTimer);
	}
	await client.destroy();
	process.exit(0);
});

client.login(token);
