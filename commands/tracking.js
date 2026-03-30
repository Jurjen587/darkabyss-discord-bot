'use strict';

const EMBED_COLOR_STATS = 0x3498db;
const EMBED_COLOR_KILL = 0xe74c3c;
const EMBED_COLOR_LEVEL = 0x9b59b6;

function createTrackingHandler({ commandPrefix, api, adminUserIds }) {
	if (!api) return { handleMessage: async () => {}, handleActivity: async () => {} };

	const prefix = commandPrefix || '&';

	async function handleMessage(message) {
		if (!message || !message.author || message.author.bot) return;
		const content = message.content.trim();
		if (!content.startsWith(prefix)) return;

		const args = content.slice(prefix.length).trim().split(/\s+/);
		const cmd = (args.shift() || '').toLowerCase();
		const isAdmin = adminUserIds.has(message.author.id) || message.member?.permissions?.has('ADMINISTRATOR');

		// &stats <eosId>
		if (cmd === 'stats') {
			const eosId = args[0];
			if (!eosId) return message.reply('Usage: `' + prefix + 'stats <eosId>`');
			try {
				const data = await api.playerStats(eosId);
				const s = data.stats;
				await message.reply({ embeds: [{ color: EMBED_COLOR_STATS, title: '📊 ' + (s.player_name || eosId), fields: [
					{ name: 'Kills', value: String(s.kills), inline: true },
					{ name: 'Deaths', value: String(s.deaths), inline: true },
					{ name: 'K/D', value: String(s.kd_ratio), inline: true },
					{ name: 'Tames', value: String(s.dinos_tamed), inline: true },
					{ name: 'Playtime', value: s.playtime_hours + 'h', inline: true },
					{ name: 'Tribe', value: s.tribe_name || 'None', inline: true },
					{ name: 'First Seen', value: s.first_seen ? '<t:' + Math.floor(new Date(s.first_seen).getTime() / 1000) + ':R>' : 'Unknown', inline: true },
					{ name: 'Last Seen', value: s.last_seen ? '<t:' + Math.floor(new Date(s.last_seen).getTime() / 1000) + ':R>' : 'Unknown', inline: true },
				] }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &leaderboard <type> [limit]
		if (cmd === 'leaderboard' || cmd === 'lb') {
			const type = args[0] || 'playtime';
			const limit = parseInt(args[1], 10) || 10;
			try {
				const data = await api.leaderboard(type, limit);
				const entries = data.leaderboard || [];
				if (entries.length === 0) return message.reply('No data for this leaderboard.');
				const lines = entries.map((e, i) => {
					const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '`' + (i + 1) + '.`';
					return medal + ' **' + (e.name || 'Unknown') + '** — ' + e.value;
				});
				const titles = { playtime: '⏱️ Playtime', kills: '⚔️ Kills', deaths: '💀 Deaths', tames: '🦕 Tames', kd: '🎯 K/D Ratio' };
				await message.reply({ embeds: [{ color: EMBED_COLOR_STATS, title: (titles[type] || '📊 ' + type) + ' Leaderboard', description: lines.join('\n') }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &killfeed [limit]
		if (cmd === 'killfeed' || cmd === 'kf') {
			const limit = parseInt(args[0], 10) || 10;
			try {
				const data = await api.killFeed(limit);
				const kills = data.kills || [];
				if (kills.length === 0) return message.reply('No kills recorded.');
				const lines = kills.map((k) => {
					const bob = k.is_bob_kill ? ' 🐣' : '';
					const time = '<t:' + Math.floor(new Date(k.occurred_at).getTime() / 1000) + ':R>';
					return '⚔️ **' + k.killer + '** killed **' + k.victim + '**' + (k.weapon ? ' with ' + k.weapon : '') + bob + ' ' + time;
				});
				await message.reply({ embeds: [{ color: EMBED_COLOR_KILL, title: '☠️ Kill Feed', description: lines.join('\n') }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &level / &rank [@user]
		if (cmd === 'level' || cmd === 'rank' || cmd === 'profile') {
			const targetUser = message.mentions.users.first() || message.author;
			try {
				const data = await api.discordLevel(targetUser.id);
				const l = data.level;
				const progressBar = createProgressBar(l.xp_to_next, l.xp_to_next + 50); // simplified
				await message.reply({ embeds: [{ color: EMBED_COLOR_LEVEL, title: '✨ ' + (l.username || targetUser.tag),
					fields: [
						{ name: 'Level', value: String(l.level), inline: true },
						{ name: 'XP', value: String(l.xp), inline: true },
						{ name: 'To Next Level', value: String(l.xp_to_next) + ' XP', inline: true },
						{ name: 'Messages', value: String(l.messages), inline: true },
						{ name: '⭐ Stars', value: String(l.stars_received), inline: true },
						{ name: 'Prestige', value: String(l.prestige), inline: true },
					],
				}] });
			} catch (err) {
				if (err.message && err.message.includes('not found')) {
					return message.reply('No level data yet. Start chatting to earn XP!');
				}
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &star @user
		if (cmd === 'star' || cmd === 'thank') {
			const target = message.mentions.users.first();
			if (!target || target.id === message.author.id) return message.reply('Mention someone to give them a ⭐!');
			try {
				const data = await api.giveStar(message.author.id, target.id, message.author.tag, target.tag);
				await message.reply('⭐ You gave a star to **' + target.tag + '**! They now have **' + data.receiver_stars_received + '** stars.');
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &dlb / &discordlb [type]
		if (cmd === 'dlb' || cmd === 'discordlb' || cmd === 'xlb') {
			const type = args[0] || 'xp';
			try {
				const data = await api.discordLeaderboard(type, 10);
				const entries = data.leaderboard || [];
				if (entries.length === 0) return message.reply('No data.');
				const lines = entries.map((e, i) => {
					const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '`' + (i + 1) + '.`';
					const val = type === 'stars' ? e.stars + ' ⭐' : type === 'messages' ? e.messages + ' msgs' : 'Lvl ' + e.level + ' (' + e.xp + ' XP)';
					return medal + ' **' + (e.username || 'Unknown') + '** — ' + val;
				});
				const titles = { xp: '✨ XP', messages: '💬 Messages', stars: '⭐ Stars' };
				await message.reply({ embeds: [{ color: EMBED_COLOR_LEVEL, title: (titles[type] || type) + ' Leaderboard', description: lines.join('\n') }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &weeklylb
		if (cmd === 'weeklylb' || cmd === 'wlb') {
			try {
				const data = await api.weeklyLeaderboard();
				const entries = data.leaderboard || [];
				if (entries.length === 0) return message.reply('No weekly data yet.');
				const lines = entries.map((e, i) => {
					const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '`' + (i + 1) + '.`';
					return medal + ' **' + (e.discord_username || 'Unknown') + '** — ' + e.xp_earned + ' XP, ' + e.messages_sent + ' msgs';
				});
				await message.reply({ embeds: [{ color: EMBED_COLOR_LEVEL, title: '📅 Weekly Leaderboard (Week of ' + data.week_start + ')', description: lines.join('\n') }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &timeline <eosId> [days]
		if (cmd === 'timeline' && isAdmin) {
			const eosId = args[0];
			const days = parseInt(args[1], 10) || 7;
			if (!eosId) return message.reply('Usage: `' + prefix + 'timeline <eosId> [days]`');
			try {
				const data = await api.playerTimeline(eosId, days);
				const sessions = data.sessions || [];
				if (sessions.length === 0) return message.reply('No sessions found.');
				const lines = sessions.slice(0, 20).map((s) => {
					const joined = '<t:' + Math.floor(new Date(s.joined_at).getTime() / 1000) + ':f>';
					const dur = s.duration_minutes ? ' (' + s.duration_minutes + 'min)' : ' (still online)';
					return (s.server || '?') + ': ' + joined + dur;
				});
				await message.reply({ embeds: [{ color: EMBED_COLOR_STATS, title: '📋 Timeline — ' + eosId, description: lines.join('\n') }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &lookback <eosId> <datetime>
		if (cmd === 'lookback' && isAdmin) {
			const eosId = args[0];
			const at = args.slice(1).join(' ');
			if (!eosId || !at) return message.reply('Usage: `' + prefix + 'lookback <eosId> <datetime>`');
			try {
				const data = await api.lookback(eosId, at);
				if (data.online) {
					await message.reply({ embeds: [{ color: 0x2ecc71, title: '🔍 Lookback', description: 'Player was **online** on **' + data.server + '**\nJoined: <t:' + Math.floor(new Date(data.joined_at).getTime() / 1000) + ':f>' }] });
				} else {
					await message.reply({ embeds: [{ color: 0xe74c3c, title: '🔍 Lookback', description: 'Player was **offline** at that time.' }] });
				}
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &whowason <datetime> [serverId]
		if (cmd === 'whowason' && isAdmin) {
			const at = args[0];
			const serverId = args[1] ? parseInt(args[1], 10) : null;
			if (!at) return message.reply('Usage: `' + prefix + 'whowason <datetime> [serverId]`');
			try {
				const data = await api.whoWasOn(args.join(' '), serverId);
				const players = data.players || [];
				if (players.length === 0) return message.reply('No one was online at that time.');
				const lines = players.map((p) => '• **' + (p.player_name || p.eos_id) + '** on ' + (p.server || '?'));
				await message.reply({ embeds: [{ color: EMBED_COLOR_STATS, title: '🔍 Who Was On', description: lines.join('\n').slice(0, 4000) }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}
	}

	// XP tracking on every message (non-command)
	async function handleActivity(message) {
		if (!message || !message.author || message.author.bot) return;
		if (message.content.startsWith(prefix)) return; // Don't gain XP from commands

		try {
			const data = await api.recordActivity(message.author.id, message.author.tag);
			if (data.leveled_up) {
				await message.channel.send({
					embeds: [{
						color: EMBED_COLOR_LEVEL,
						title: '🎉 Level Up!',
						description: '**' + message.author.tag + '** reached **Level ' + data.level + '**!',
					}],
				}).catch(() => {});
			}
		} catch {
			// Silently ignore activity tracking errors
		}
	}

	return { handleMessage, handleActivity };
}

function createProgressBar(current, total) {
	const filled = Math.round((current / Math.max(total, 1)) * 10);
	return '▓'.repeat(filled) + '░'.repeat(10 - filled);
}

module.exports = { createTrackingHandler };
