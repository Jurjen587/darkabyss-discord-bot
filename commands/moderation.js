'use strict';

const EMBED_COLOR_MOD = 0xe67e22;
const EMBED_COLOR_ALERT = 0xe74c3c;
const EMBED_COLOR_TRIBE = 0x1abc9c;

function createModerationHandler({ commandPrefix, api, adminUserIds }) {
	if (!api) return { handleMessage: async () => {} };

	const prefix = commandPrefix || '&';

	async function handleMessage(message) {
		if (!message || !message.author || message.author.bot) return;
		const content = message.content.trim();
		if (!content.startsWith(prefix)) return;

		const args = content.slice(prefix.length).trim().split(/\s+/);
		const cmd = (args.shift() || '').toLowerCase();
		const isAdmin = adminUserIds.has(message.author.id) || message.member?.permissions?.has('ADMINISTRATOR');

		// &watchlist [add|remove] — admin only
		if (cmd === 'watchlist' && isAdmin) {
			const action = (args[0] || '').toLowerCase();

			if (action === 'add') {
				const eosId = args[1];
				const reason = args.slice(2).join(' ') || 'No reason';
				if (!eosId) return message.reply('Usage: `' + prefix + 'watchlist add <eosId> [reason]`');
				try {
					await api.addToWatchlist(eosId, reason, message.author.id, message.author.tag);
					await message.reply('✅ Added **' + eosId + '** to watchlist.');
				} catch (err) {
					await message.reply('❌ ' + (err.message || err));
				}
				return;
			}

			// Default: show watchlist
			try {
				const data = await api.watchlist();
				const entries = data.entries || [];
				if (entries.length === 0) return message.reply('Watchlist is empty.');
				const lines = entries.map((e) =>
					'• **' + (e.player_name || e.eos_id) + '** — ' + e.reason + ' (by ' + (e.added_by_name || '?') + ')'
				);
				await message.reply({ embeds: [{ color: EMBED_COLOR_ALERT, title: '👁️ Watchlist', description: lines.join('\n').slice(0, 4000) }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &tribelog <serverId> [limit]
		if (cmd === 'tribelog' && isAdmin) {
			const serverId = parseInt(args[0], 10);
			const limit = parseInt(args[1], 10) || 20;
			if (!serverId) return message.reply('Usage: `' + prefix + 'tribelog <serverId> [limit]`');
			try {
				const data = await api.tribeLogs(serverId, limit);
				const logs = data.logs || [];
				if (logs.length === 0) return message.reply('No tribe logs recorded for this server.');
				const lines = logs.slice(0, 20).map((l) => {
					const time = '<t:' + Math.floor(new Date(l.occurred_at).getTime() / 1000) + ':R>';
					return '`' + l.type + '` ' + l.content.slice(0, 100) + ' ' + time;
				});
				await message.reply({ embeds: [{ color: EMBED_COLOR_TRIBE, title: '📜 Tribe Logs — Server ' + serverId, description: lines.join('\n').slice(0, 4000) }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &tribesub <serverId> <tribeName> — subscribe to tribelog alerts
		if (cmd === 'tribesub' && isAdmin) {
			const serverId = parseInt(args[0], 10);
			const tribeName = args.slice(1).join(' ');
			if (!serverId || !tribeName) return message.reply('Usage: `' + prefix + 'tribesub <serverId> <tribeName>`');
			try {
				await api.subscribeTribelog(message.channel.id, serverId, tribeName);
				await message.reply('✅ Subscribed to tribe log alerts for **' + tribeName + '** on server ' + serverId + ' in this channel.');
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &starterkit <clusterId>
		if (cmd === 'starterkit' || cmd === 'sk') {
			const clusterId = parseInt(args[0], 10);
			if (!clusterId) return message.reply('Usage: `' + prefix + 'starterkit <clusterId>`');
			try {
				const data = await api.claimStarterKit(message.author.id, message.author.tag, clusterId);
				await message.reply('✅ Starter kit claimed! Items delivered: ' + (data.items_delivered || 'Check in-game'));
			} catch (err) {
				if (err.message && err.message.includes('already claimed')) {
					return message.reply('❌ You already claimed a starter kit for this cluster.');
				}
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &imstuck <serverId>
		if (cmd === 'imstuck' || cmd === 'stuck') {
			const serverId = parseInt(args[0], 10);
			if (!serverId) return message.reply('Usage: `' + prefix + 'imstuck <serverId>`');
			try {
				const data = await api.imStuck(message.author.id, serverId);
				await message.reply('✅ Teleport command executed. ' + (data.response || ''));
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// === Investigation Commands (admin) ===

		// &hunt <serverId> <dinoName>
		if (cmd === 'hunt' && isAdmin) {
			const serverId = parseInt(args[0], 10);
			const dinoName = args.slice(1).join(' ');
			if (!serverId || !dinoName) return message.reply('Usage: `' + prefix + 'hunt <serverId> <dinoName>`');
			try {
				const data = await api.hunt(serverId, dinoName);
				await message.reply({ embeds: [{ color: EMBED_COLOR_MOD, title: '🔍 Hunt — ' + dinoName, description: '```\n' + (data.response || 'No results').slice(0, 3900) + '\n```' }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &findtame <serverId> <query>
		if (cmd === 'findtame' && isAdmin) {
			const serverId = parseInt(args[0], 10);
			const query = args.slice(1).join(' ');
			if (!serverId || !query) return message.reply('Usage: `' + prefix + 'findtame <serverId> <query>`');
			try {
				const data = await api.findTame(serverId, query);
				await message.reply({ embeds: [{ color: EMBED_COLOR_MOD, title: '🦕 Find Tame', description: '```\n' + (data.response || 'No results').slice(0, 3900) + '\n```' }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &territory <serverId> <tribeName>
		if (cmd === 'territory' && isAdmin) {
			const serverId = parseInt(args[0], 10);
			const tribeName = args.slice(1).join(' ');
			if (!serverId || !tribeName) return message.reply('Usage: `' + prefix + 'territory <serverId> <tribeName>`');
			try {
				const data = await api.territory(serverId, tribeName);
				await message.reply({ embeds: [{ color: EMBED_COLOR_MOD, title: '🗺️ Territory — ' + tribeName, description: '```\n' + (data.response || 'No results').slice(0, 3900) + '\n```' }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &findstructure <serverId> <query>
		if (cmd === 'findstructure' || cmd === 'fs' && isAdmin) {
			if (!isAdmin) return;
			const serverId = parseInt(args[0], 10);
			const query = args.slice(1).join(' ');
			if (!serverId || !query) return message.reply('Usage: `' + prefix + 'findstructure <serverId> <query>`');
			try {
				const data = await api.findStructures(serverId, query);
				await message.reply({ embeds: [{ color: EMBED_COLOR_MOD, title: '🏗️ Find Structure', description: '```\n' + (data.response || 'No results').slice(0, 3900) + '\n```' }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &foreigntames <serverId>
		if (cmd === 'foreigntames' && isAdmin) {
			const serverId = parseInt(args[0], 10);
			if (!serverId) return message.reply('Usage: `' + prefix + 'foreigntames <serverId>`');
			try {
				const data = await api.foreignTames(serverId);
				await message.reply({ embeds: [{ color: EMBED_COLOR_ALERT, title: '⚠️ Foreign Tames', description: '```\n' + (data.response || 'No foreign tames detected').slice(0, 3900) + '\n```' }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &massbreed <serverId>
		if (cmd === 'massbreed' && isAdmin) {
			const serverId = parseInt(args[0], 10);
			if (!serverId) return message.reply('Usage: `' + prefix + 'massbreed <serverId>`');
			try {
				const data = await api.massBreed(serverId);
				await message.reply({ embeds: [{ color: EMBED_COLOR_ALERT, title: '🥚 Mass Breed Detection', description: '```\n' + (data.response || 'No mass breeding detected').slice(0, 3900) + '\n```' }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &tamestat <serverId>
		if (cmd === 'tamestat' && isAdmin) {
			const serverId = parseInt(args[0], 10);
			if (!serverId) return message.reply('Usage: `' + prefix + 'tamestat <serverId>`');
			try {
				const data = await api.tameStatCheck(serverId);
				await message.reply({ embeds: [{ color: EMBED_COLOR_ALERT, title: '📊 Tame Stat Check', description: '```\n' + (data.response || 'All stats within limits').slice(0, 3900) + '\n```' }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &uncryo <serverId>
		if (cmd === 'uncryo' && isAdmin) {
			const serverId = parseInt(args[0], 10);
			if (!serverId) return message.reply('Usage: `' + prefix + 'uncryo <serverId>`');
			try {
				const data = await api.uncryoLimits(serverId);
				await message.reply({ embeds: [{ color: EMBED_COLOR_ALERT, title: '❄️ Uncryo Limits', description: '```\n' + (data.response || 'No issues').slice(0, 3900) + '\n```' }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &playtimeroles
		if (cmd === 'playtimeroles' && isAdmin) {
			try {
				const data = await api.playtimeRoles();
				const roles = data.roles || [];
				if (roles.length === 0) return message.reply('No playtime roles configured.');
				const lines = roles.map((r) => '• ' + r.hours_required + 'h → <@&' + r.role_id + '>');
				await message.reply({ embeds: [{ color: EMBED_COLOR_MOD, title: '⏱️ Playtime Roles', description: lines.join('\n') }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}
	}

	return { handleMessage };
}

module.exports = { createModerationHandler };
