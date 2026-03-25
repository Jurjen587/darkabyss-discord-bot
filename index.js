const path = require('path');
const fs = require('fs');
const https = require('https');
const dotenv = require('dotenv');
const { Client, Intents, Permissions } = require('discord.js');

dotenv.config({ path: path.join(__dirname, '.env') });

const token = (process.env.DISCORD_BOT_TOKEN || '').trim();
if (!token) {
	console.error('DISCORD_BOT_TOKEN is missing in discord-bot/.env');
	process.exit(1);
}

const status = (process.env.DISCORD_BOT_STATUS || 'online').toLowerCase();
const activityTypeRaw = (process.env.DISCORD_BOT_ACTIVITY_TYPE || 'Watching').toLowerCase();
const activityText = process.env.DISCORD_BOT_ACTIVITY_TEXT || 'darkabyss.nl';

const nitradoApiBaseUrl = (process.env.NITRADO_API_BASE_URL || 'https://api.nitrado.net').replace(/\/+$/, '');
const pollSecondsValue = Number.parseInt(process.env.NITRADO_POLL_SECONDS || '120', 10);
const nitradoPollSeconds = Number.isFinite(pollSecondsValue) ? Math.max(30, pollSecondsValue) : 120;
const balanceStartingAmountRaw = Number.parseFloat(process.env.BALANCE_STARTING_AMOUNT || '0');
const balanceStartingAmount = Number.isFinite(balanceStartingAmountRaw) ? Math.max(0, balanceStartingAmountRaw) : 0;
const adminUserIds = new Set(
	(process.env.BALANCE_ADMIN_USER_IDS || '')
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value !== '')
);

const dataDir = path.join(__dirname, 'data');
const balancesPath = path.join(dataDir, 'balances.json');

function ensureDataFiles() {
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}

	if (!fs.existsSync(balancesPath)) {
		fs.writeFileSync(balancesPath, JSON.stringify({}, null, 2) + '\n', 'utf8');
	}
}

function readBalances() {
	ensureDataFiles();

	try {
		const raw = fs.readFileSync(balancesPath, 'utf8');
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed;
		}
	} catch (error) {
		console.error('Failed to read balances.json, starting with empty balances:', error.message || error);
	}

	return {};
}

function writeBalances(balances) {
	ensureDataFiles();
	fs.writeFileSync(balancesPath, JSON.stringify(balances, null, 2) + '\n', 'utf8');
}

let balances = readBalances();

function normalizeAmount(value) {
	return Math.round(value * 100) / 100;
}

function getBalance(userId) {
	const existing = Number(balances[userId]);
	if (Number.isFinite(existing) && existing >= 0) {
		return normalizeAmount(existing);
	}

	balances[userId] = normalizeAmount(balanceStartingAmount);
	writeBalances(balances);
	return balances[userId];
}

function setBalance(userId, amount) {
	balances[userId] = normalizeAmount(Math.max(0, amount));
	writeBalances(balances);
	return balances[userId];
}

function parseAmount(raw) {
	const value = Number.parseFloat(raw);
	if (!Number.isFinite(value)) {
		return null;
	}

	return normalizeAmount(value);
}

function formatAmount(amount) {
	return normalizeAmount(amount).toLocaleString('en-US', {
		minimumFractionDigits: 0,
		maximumFractionDigits: 2,
	});
}

function parseUserArgument(rawValue, message) {
	if (!rawValue) {
		return null;
	}

	if (message.mentions.users.size > 0) {
		return message.mentions.users.first();
	}

	const id = rawValue.replace(/[<@!>]/g, '');
	if (!/^\d{15,25}$/.test(id)) {
		return null;
	}

	return message.client.users.cache.get(id) || null;
}

function isBalanceAdmin(message) {
	if (adminUserIds.has(message.author.id)) {
		return true;
	}

	if (message.member && message.member.permissions && message.member.permissions.has(Permissions.FLAGS.ADMINISTRATOR)) {
		return true;
	}

	return false;
}

async function handleBalanceCommand(message) {
	const content = (message.content || '').trim();
	if (!content.startsWith('/')) {
		return;
	}

	const parts = content.split(/\s+/);
	const baseCommand = (parts[0] || '').toLowerCase();
	if (baseCommand !== '/balance' && baseCommand !== '/bal') {
		return;
	}

	const subCommand = (parts[1] || '').toLowerCase();

	if (!subCommand) {
		const targetUser = message.mentions.users.first() || message.author;
		const amount = getBalance(targetUser.id);
		await message.reply(targetUser.id === message.author.id
			? 'Your balance is **' + formatAmount(amount) + '**.'
			: targetUser.username + ' has **' + formatAmount(amount) + '**.');
		return;
	}

	if (subCommand.startsWith('<@') || /^\d{15,25}$/.test(subCommand)) {
		const targetUser = parseUserArgument(parts[1], message);
		if (!targetUser || targetUser.bot) {
			await message.reply('Usage: `/bal @user`');
			return;
		}

		const amount = getBalance(targetUser.id);
		await message.reply(targetUser.username + ' has **' + formatAmount(amount) + '**.');
		return;
	}

	if (subCommand === 'transfer') {
		const targetUser = parseUserArgument(parts[2], message);
		const amount = parseAmount(parts[3]);

		if (!targetUser || targetUser.bot) {
			await message.reply('Usage: `/bal transfer @user amount`');
			return;
		}

		if (!Number.isFinite(amount) || amount <= 0) {
			await message.reply('Transfer amount must be a number greater than 0.');
			return;
		}

		if (targetUser.id === message.author.id) {
			await message.reply('You cannot transfer balance to yourself.');
			return;
		}

		const senderBalance = getBalance(message.author.id);
		if (senderBalance < amount) {
			await message.reply('Insufficient balance. You have **' + formatAmount(senderBalance) + '**.');
			return;
		}

		setBalance(message.author.id, senderBalance - amount);
		setBalance(targetUser.id, getBalance(targetUser.id) + amount);

		await message.reply('Transferred **' + formatAmount(amount) + '** to ' + targetUser.toString() + '.');
		return;
	}

	if (subCommand === 'set' || subCommand === 'add' || subCommand === 'remove') {
		if (!isBalanceAdmin(message)) {
			await message.reply('You need admin permissions to use this command.');
			return;
		}

		const targetUser = parseUserArgument(parts[2], message);
		const amount = parseAmount(parts[3]);

		if (!targetUser || targetUser.bot) {
			await message.reply('Usage: `/bal ' + subCommand + ' @user amount`');
			return;
		}

		if (!Number.isFinite(amount) || amount < 0) {
			await message.reply('Amount must be a number of 0 or higher.');
			return;
		}

		let nextBalance = getBalance(targetUser.id);
		if (subCommand === 'set') {
			nextBalance = amount;
		}

		if (subCommand === 'add') {
			nextBalance += amount;
		}

		if (subCommand === 'remove') {
			nextBalance = Math.max(0, nextBalance - amount);
		}

		setBalance(targetUser.id, nextBalance);
		await message.reply(targetUser.toString() + ' now has **' + formatAmount(nextBalance) + '**.');
		return;
	}

	if (subCommand === 'top' || subCommand === 'leaderboard') {
		const topEntries = Object.entries(balances)
			.map(([userId, amount]) => [userId, Number(amount)])
			.filter(([, amount]) => Number.isFinite(amount) && amount > 0)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10);

		if (topEntries.length === 0) {
			await message.reply('No balances yet.');
			return;
		}

		const lines = topEntries.map(([userId, amount], index) => {
			const member = message.guild ? message.guild.members.cache.get(userId) : null;
			const name = member ? member.user.username : 'User ' + userId;
			return (index + 1) + '. ' + name + ' - ' + formatAmount(amount);
		});

		await message.reply('Balance leaderboard:\n' + lines.join('\n'));
		return;
	}

	if (subCommand === 'help') {
		await message.reply([
			'Balance commands:',
			'`/balance` or `/bal`',
			'`/bal @user`',
			'`/bal transfer @user amount`',
			'`/bal top`',
			'Admin: `/bal set @user amount`, `/bal add @user amount`, `/bal remove @user amount`',
		].join('\n'));
		return;
	}

	await message.reply('Unknown balance command. Use `/bal help`.');
}

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

const client = new Client({
	intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MESSAGE_CONTENT],
});

let lastPresenceText = '';
let pollTimer = null;

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
	setPresence(activityText);

	if (nitradoAccounts.length > 0) {
		const totalServices = nitradoAccounts.reduce((sum, account) => sum + account.serviceIds.length, 0);
		console.log('Nitrado player count polling enabled: ' + nitradoAccounts.length + ' account(s), ' + totalServices + ' service(s), every ' + nitradoPollSeconds + 's');

		try {
			await updatePresenceFromNitrado();
		} catch (error) {
			console.error('Initial Nitrado poll failed:', error.message || error);
			setPresence(activityText);
		}

		pollTimer = setInterval(() => {
			updatePresenceFromNitrado().catch((error) => {
				console.error('Nitrado poll cycle failed:', error.message || error);
				setPresence(activityText);
			});
		}, nitradoPollSeconds * 1000);
	} else {
		console.log('Nitrado polling disabled. Set NITRADO_1_API_TOKEN/NITRADO_1_SERVICE_IDS and NITRADO_2_API_TOKEN/NITRADO_2_SERVICE_IDS to enable it.');
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
	await client.destroy();
	process.exit(0);
});

client.login(token);
