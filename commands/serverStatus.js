'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const COLOR_ONLINE  = 0x2ecc71; // green  — all servers up
const COLOR_PARTIAL = 0xe67e22; // orange — some servers up
const COLOR_OFFLINE = 0xe74c3c; // red    — all servers down

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function fetchJson(url, headers) {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { headers }, (res) => {
			const chunks = [];
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', () => {
				const body = Buffer.concat(chunks).toString('utf8');
				if (res.statusCode < 200 || res.statusCode >= 300) {
					reject(new Error('Nitrado HTTP ' + res.statusCode + ': ' + body.slice(0, 200)));
					return;
				}
				try {
					resolve(JSON.parse(body));
				} catch {
					reject(new Error('Nitrado returned a non-JSON response.'));
				}
			});
		});
		req.on('error', (err) => reject(err));
		req.setTimeout(10000, () => req.destroy(new Error('Nitrado request timed out.')));
	});
}

// ─── Data extraction ─────────────────────────────────────────────────────────

function extractServerInfo(payload, serviceId) {
	const gs    = payload?.data?.gameserver ?? {};
	const query = gs.query ?? {};
	const svc   = payload?.data?.service ?? {};

	const name =
		query.server_name ||
		gs.name ||
		svc.name ||
		('Server ' + serviceId);

	const map =
		query.map ||
		gs.settings?.general?.map ||
		gs.settings?.config?.map ||
		null;

	// Current player count — try multiple known response shapes
	const countCandidates = [
		query.player_current,
		query.players,
		gs.players,
		gs.player_current,
		svc.details?.player_current,
		svc.details?.players,
	];
	let playerCurrent = null;
	for (const v of countCandidates) {
		const n = Number(v);
		if (Number.isFinite(n)) { playerCurrent = n; break; }
	}
	if (playerCurrent === null && Array.isArray(query.player_list)) {
		playerCurrent = query.player_list.length;
	}

	// Max player count
	const maxCandidates = [query.player_max, query.max_players, gs.slots];
	let playerMax = null;
	for (const v of maxCandidates) {
		const n = Number(v);
		if (Number.isFinite(n) && n > 0) { playerMax = n; break; }
	}

	const statusRaw = (gs.status ?? '').toLowerCase();
	const online    = statusRaw === 'started' || statusRaw === 'running';

	return { name, map, playerCurrent, playerMax, online };
}

// ─── Embed builder ────────────────────────────────────────────────────────────

function buildStatusEmbed(results, updatedAt) {
	const total       = results.length;
	const onlineCount = results.filter((r) => !r.error && r.info?.online).length;

	let color;
	if (total === 0 || onlineCount === 0) color = COLOR_OFFLINE;
	else if (onlineCount < total)         color = COLOR_PARTIAL;
	else                                  color = COLOR_ONLINE;

	const lines = [];

	for (const { info, error, serviceId } of results) {
		// Blank spacer between server entries
		if (lines.length > 0) lines.push('');

		if (error || !info) {
			lines.push('🔴  **Server ' + serviceId + '**');
			lines.push('> ⚠️  Could not fetch status');
		} else if (!info.online) {
			lines.push('🔴  **' + info.name + '**');
			lines.push('> Server is offline');
		} else {
			const playerStr = info.playerCurrent !== null
				? '👥  **' + info.playerCurrent +
				  (info.playerMax !== null ? ' / ' + info.playerMax : '') +
				  '** players'
				: '👥  Players: unknown';
			const mapStr = info.map ? '🗺️  ' + info.map : '';

			lines.push('🟢  **' + info.name + '**');
			lines.push('> ' + [playerStr, mapStr].filter(Boolean).join('　·　'));
		}
	}

	const body = lines.length > 0
		? lines.join('\n')
		: '*No servers are configured.*';

	const description =
		body +
		'\n\n──────────────────────────────\n' +
		'🕐  Last updated <t:' + Math.floor(updatedAt / 1000) + ':R>';

	return {
		title: '🎮  DarkAbyss — Server Status',
		description,
		color,
		footer: {
			text: (onlineCount + 5) + ' / ' + total + ' server' + (total !== 1 ? 's' : '') + ' online',
		},
		timestamp: new Date(updatedAt).toISOString(),
	};
}

// ─── Handler factory ──────────────────────────────────────────────────────────

function createServerStatusHandler({ client, channelId, nitradoAccounts, nitradoApiBaseUrl }) {
	if (!channelId) return null;

	const base        = (nitradoApiBaseUrl || 'https://api.nitrado.net').replace(/\/+$/, '');
	const stateFile   = path.join(__dirname, '..', 'data', 'server-status-state.json');

	// Load persisted message ID from disk (survives bot restarts)
	function loadState() {
		try {
			const raw = fs.readFileSync(stateFile, 'utf8');
			return JSON.parse(raw);
		} catch {
			return {};
		}
	}

	function saveState(state) {
		try {
			fs.mkdirSync(path.dirname(stateFile), { recursive: true });
			fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
		} catch (err) {
			console.warn('[ServerStatus] Could not save state:', err.message);
		}
	}

	let postedMessageId = loadState().messageId ?? null;

	async function fetchAllServers() {
		const results = [];
		for (const account of nitradoAccounts) {
			for (const serviceId of account.serviceIds) {
				const url = base + '/services/' + serviceId + '/gameservers';
				try {
					const payload = await fetchJson(url, {
						Authorization: 'Bearer ' + account.token,
						Accept: 'application/json',
					});
					results.push({ serviceId, info: extractServerInfo(payload, serviceId) });
				} catch (err) {
					results.push({ serviceId, error: err.message });
				}
			}
		}
		return results;
	}

	async function update() {
		const channel = await client.channels.fetch(channelId).catch(() => null);
		if (!channel) {
			console.warn('[ServerStatus] Channel ' + channelId + ' not found or bot has no access.');
			return;
		}

		const results = await fetchAllServers();
		const embed   = buildStatusEmbed(results, Date.now());

		// Edit the existing message when possible
		if (postedMessageId) {
			const existing = await channel.messages.fetch(postedMessageId).catch(() => null);
			if (existing) {
				await existing.edit({ embeds: [embed] });
				return;
			}
			// Message was deleted — clear the stored ID
			postedMessageId = null;
			saveState({});
		}

		// Post a fresh message if none exists
		const msg = await channel.send({ embeds: [embed] });
		postedMessageId = msg.id;
		saveState({ messageId: msg.id });
		console.log('[ServerStatus] Posted status embed (message ' + msg.id + ')');
	}

	return { update };
}

module.exports = { createServerStatusHandler };
