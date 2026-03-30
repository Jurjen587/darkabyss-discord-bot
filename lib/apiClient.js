'use strict';

const https = require('https');
const http = require('http');

/**
 * Creates a reusable API client for the Laravel backend.
 * All new features route through this client instead of direct RCON.
 */
function createApiClient({ baseUrl, apiToken }) {
	if (!baseUrl || !apiToken) {
		return null;
	}

	function request(method, endpoint, payload) {
		return new Promise((resolve, reject) => {
			const url = new URL(baseUrl + endpoint);
			const body = payload ? JSON.stringify(payload) : '';
			const transport = url.protocol === 'https:' ? https : http;

			const req = transport.request(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(body),
					'X-Discord-Shop-Token': apiToken,
					'Accept': 'application/json',
				},
			}, (res) => {
				const chunks = [];
				res.on('data', (chunk) => chunks.push(chunk));
				res.on('end', () => {
					const raw = Buffer.concat(chunks).toString('utf8');
					let parsed;
					try {
						parsed = raw ? JSON.parse(raw) : {};
					} catch {
						parsed = {};
					}

					if (res.statusCode === 429) {
						const retryAfter = Number(res.headers['retry-after']) || 2;
						reject({ retryAfter, statusCode: 429, message: parsed.message || 'Rate limited' });
						return;
					}

					if (res.statusCode >= 400) {
						reject(new Error(parsed.error || parsed.message || 'API error (' + res.statusCode + ')'));
						return;
					}

					resolve(parsed);
				});
			});

			req.on('error', (err) => reject(err));
			req.setTimeout(15000, () => req.destroy(new Error('API request timed out')));
			if (body) req.write(body);
			req.end();
		});
	}

	async function retryRequest(method, endpoint, payload, maxRetries = 2) {
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await request(method, endpoint, payload);
			} catch (err) {
				if (err.retryAfter && attempt < maxRetries) {
					await new Promise((r) => setTimeout(r, err.retryAfter * 1000));
					continue;
				}
				throw err;
			}
		}
	}

	return {
		get: (endpoint) => retryRequest('GET', endpoint),
		post: (endpoint, payload) => retryRequest('POST', endpoint, payload),
		del: (endpoint) => retryRequest('DELETE', endpoint),
		put: (endpoint, payload) => retryRequest('PUT', endpoint, payload),

		// ── Server Management ──────────────────────────────
		servers: () => retryRequest('GET', '/api/discord/servers'),
		rconExecute: (serverId, command) => retryRequest('POST', '/api/discord/servers/rcon', { server_id: serverId, command }),
		rconBroadcast: (clusterId, command) => retryRequest('POST', '/api/discord/servers/rcon/broadcast', { cluster_id: clusterId, command }),
		listPlayers: (serverId) => retryRequest('GET', '/api/discord/servers/players?server_id=' + serverId),
		listAllPlayers: (clusterId) => retryRequest('GET', '/api/discord/servers/players/all' + (clusterId ? '?cluster_id=' + clusterId : '')),

		// Cross-Chat
		chatBridgeConfigs: () => retryRequest('GET', '/api/discord/servers/chat/configs'),
		pollChat: (serverId) => retryRequest('POST', '/api/discord/servers/chat/poll', { server_id: serverId }),
		sendChat: (serverId, senderName, message) => retryRequest('POST', '/api/discord/servers/chat/send', { server_id: serverId, sender_name: senderName, message }),
		broadcastChat: (clusterId, senderName, message, excludeServerId) => retryRequest('POST', '/api/discord/servers/chat/broadcast', { cluster_id: clusterId, sender_name: senderName, message, exclude_server_id: excludeServerId }),

		// Scheduled Commands
		scheduledCommands: () => retryRequest('GET', '/api/discord/servers/scheduled'),
		createScheduledCommand: (data) => retryRequest('POST', '/api/discord/servers/scheduled', data),
		deleteScheduledCommand: (id) => retryRequest('DELETE', '/api/discord/servers/scheduled/' + id),
		runDueCommands: () => retryRequest('POST', '/api/discord/servers/scheduled/run-due'),

		// Ban Sync
		bans: (clusterId) => retryRequest('GET', '/api/discord/servers/bans' + (clusterId ? '?cluster_id=' + clusterId : '')),
		createBan: (data) => retryRequest('POST', '/api/discord/servers/bans', data),
		removeBan: (id) => retryRequest('DELETE', '/api/discord/servers/bans/' + id),

		// Imposter Protection
		reportImposter: (data) => retryRequest('POST', '/api/discord/servers/imposter', data),

		// ── Economy ────────────────────────────────────────
		lootboxes: () => retryRequest('GET', '/api/discord/economy/lootboxes'),
		openLootbox: (id, discordUserId, currentBalance) => retryRequest('POST', '/api/discord/economy/lootboxes/' + id + '/open', { discord_user_id: discordUserId, current_balance: currentBalance }),
		logTransaction: (data) => retryRequest('POST', '/api/discord/economy/transactions', data),
		transactionHistory: (discordUserId, limit) => retryRequest('GET', '/api/discord/economy/transactions?discord_user_id=' + discordUserId + (limit ? '&limit=' + limit : '')),
		economySettings: () => retryRequest('GET', '/api/discord/economy/settings'),
		roleDiscounts: () => retryRequest('GET', '/api/discord/economy/discounts/roles'),
		setRoleDiscount: (data) => retryRequest('POST', '/api/discord/economy/discounts/roles', data),
		deleteRoleDiscount: (id) => retryRequest('DELETE', '/api/discord/economy/discounts/roles/' + id),
		dailyDiscounts: () => retryRequest('GET', '/api/discord/economy/discounts/daily'),
		todaysDiscount: () => retryRequest('GET', '/api/discord/economy/discounts/daily/today'),
		setDailyDiscount: (data) => retryRequest('POST', '/api/discord/economy/discounts/daily', data),
		calculatePrice: (packageId, roleIds) => retryRequest('POST', '/api/discord/economy/calculate-price', { package_id: packageId, discord_role_ids: roleIds }),
		paydayConfigs: () => retryRequest('GET', '/api/discord/economy/payday/configs'),
		claimPayday: (data) => retryRequest('POST', '/api/discord/economy/payday/claim', data),

		// ── Tracking ───────────────────────────────────────
		playerStats: (eosId) => retryRequest('GET', '/api/discord/tracking/stats/' + eosId),
		updatePlayerStats: (data) => retryRequest('POST', '/api/discord/tracking/stats', data),
		leaderboard: (type, limit) => retryRequest('GET', '/api/discord/tracking/leaderboard/' + type + (limit ? '?limit=' + limit : '')),
		killFeed: (limit) => retryRequest('GET', '/api/discord/tracking/kills' + (limit ? '?limit=' + limit : '')),
		recordKill: (data) => retryRequest('POST', '/api/discord/tracking/kills', data),
		discordLevel: (discordId) => retryRequest('GET', '/api/discord/tracking/levels/' + discordId),
		recordActivity: (discordId, username, xp) => retryRequest('POST', '/api/discord/tracking/levels/activity', { discord_id: discordId, discord_username: username, xp_amount: xp }),
		giveStar: (fromId, toId, fromName, toName) => retryRequest('POST', '/api/discord/tracking/levels/star', { from_discord_id: fromId, to_discord_id: toId, from_username: fromName, to_username: toName }),
		discordLeaderboard: (type, limit) => retryRequest('GET', '/api/discord/tracking/levels/leaderboard?type=' + (type || 'xp') + (limit ? '&limit=' + limit : '')),
		weeklyLeaderboard: () => retryRequest('GET', '/api/discord/tracking/weekly'),
		snapshotWeekly: () => retryRequest('POST', '/api/discord/tracking/weekly/snapshot'),
		recordJoin: (eosId, playerName, serverId) => retryRequest('POST', '/api/discord/tracking/sessions/join', { eos_id: eosId, player_name: playerName, ark_server_id: serverId }),
		recordLeave: (eosId, serverId) => retryRequest('POST', '/api/discord/tracking/sessions/leave', { eos_id: eosId, ark_server_id: serverId }),
		playerTimeline: (eosId, days) => retryRequest('GET', '/api/discord/tracking/sessions/timeline/' + eosId + (days ? '?days=' + days : '')),
		lookback: (eosId, at) => retryRequest('GET', '/api/discord/tracking/sessions/lookback?eos_id=' + eosId + '&at=' + encodeURIComponent(at)),
		whoWasOn: (at, serverId) => retryRequest('GET', '/api/discord/tracking/sessions/who-was-on?at=' + encodeURIComponent(at) + (serverId ? '&server_id=' + serverId : '')),
		playtimeRoles: () => retryRequest('GET', '/api/discord/tracking/playtime-roles'),
		checkPlaytimeRoles: (eosId) => retryRequest('POST', '/api/discord/tracking/playtime-roles/check', { eos_id: eosId }),

		// ── Moderation ─────────────────────────────────────
		watchlist: () => retryRequest('GET', '/api/discord/moderation/watchlist'),
		addToWatchlist: (data) => retryRequest('POST', '/api/discord/moderation/watchlist', data),
		removeFromWatchlist: (id) => retryRequest('DELETE', '/api/discord/moderation/watchlist/' + id),
		checkWatchlist: (playerIds) => retryRequest('POST', '/api/discord/moderation/watchlist/check', { player_ids: playerIds }),
		tribeLogs: (tribeId, limit, type) => retryRequest('GET', '/api/discord/moderation/tribelogs/' + tribeId + '?limit=' + (limit || 50) + (type ? '&type=' + type : '')),
		ingestTribeLogs: (logs) => retryRequest('POST', '/api/discord/moderation/tribelogs', { logs }),
		tribelogSubscriptions: (discordUserId) => retryRequest('GET', '/api/discord/moderation/tribelog-alerts' + (discordUserId ? '?discord_user_id=' + discordUserId : '')),
		subscribeTribelog: (data) => retryRequest('POST', '/api/discord/moderation/tribelog-alerts', data),
		unsubscribeTribelog: (id) => retryRequest('DELETE', '/api/discord/moderation/tribelog-alerts/' + id),
		claimStarterKit: (data) => retryRequest('POST', '/api/discord/moderation/starter-kit', data),
		imStuck: (eosId) => retryRequest('POST', '/api/discord/moderation/im-stuck', { eos_id: eosId }),
		hunt: (serverId, dinoName) => retryRequest('POST', '/api/discord/moderation/hunt', { server_id: serverId, dino_name: dinoName }),
		findTame: (serverId, search, type) => retryRequest('POST', '/api/discord/moderation/find-tame', { server_id: serverId, search, type }),
		territory: (serverId) => retryRequest('POST', '/api/discord/moderation/territory', { server_id: serverId }),
		findStructures: (serverId, structureType) => retryRequest('POST', '/api/discord/moderation/find-structures', { server_id: serverId, structure_type: structureType }),
		foreignTames: (serverId) => retryRequest('POST', '/api/discord/moderation/foreign-tames', { server_id: serverId }),
		massBreed: (serverId, threshold) => retryRequest('POST', '/api/discord/moderation/mass-breed', { server_id: serverId, threshold }),
		tameStatCheck: (serverId, stat, threshold) => retryRequest('POST', '/api/discord/moderation/tame-stat-check', { server_id: serverId, stat, threshold }),
		uncryoLimits: (serverId) => retryRequest('POST', '/api/discord/moderation/uncryo-limits', { server_id: serverId }),
	};
}

module.exports = { createApiClient };
