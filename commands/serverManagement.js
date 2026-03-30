'use strict';

const EMBED_COLOR = 0xe67e22;

function createServerManagementHandler({ commandPrefix, api, adminUserIds }) {
	if (!api) return async () => {};

	const prefix = commandPrefix || '&';

	return async function handleMessage(message) {
		if (!message || !message.author || message.author.bot) return;
		const content = message.content.trim();
		if (!content.startsWith(prefix)) return;

		const args = content.slice(prefix.length).trim().split(/\s+/);
		const cmd = (args.shift() || '').toLowerCase();

		const isAdmin = adminUserIds.has(message.author.id) || message.member?.permissions?.has('ADMINISTRATOR');

		// &rcon <serverId> <command...>
		if (cmd === 'rcon' && isAdmin) {
			const serverId = parseInt(args[0], 10);
			const command = args.slice(1).join(' ');
			if (!serverId || !command) {
				return message.reply('Usage: `' + prefix + 'rcon <serverId> <command>`');
			}
			try {
				const data = await api.rconExecute(serverId, command);
				const response = data.response || 'No response';
				await message.reply({ embeds: [{ color: EMBED_COLOR, title: '🖥️ RCON Response', description: '```\n' + response.slice(0, 1900) + '\n```' }] });
			} catch (err) {
				await message.reply('❌ RCON failed: ' + (err.message || err));
			}
			return;
		}

		// &broadcast <clusterId> <command...>
		if (cmd === 'broadcast' && isAdmin) {
			const clusterId = parseInt(args[0], 10);
			const command = args.slice(1).join(' ');
			if (!clusterId || !command) {
				return message.reply('Usage: `' + prefix + 'broadcast <clusterId> <command>`');
			}
			try {
				const data = await api.rconBroadcast(clusterId, command);
				const lines = (data.results || []).map((r) =>
					(r.success ? '✅' : '❌') + ' ' + r.name + ': ' + (r.response || r.error || '-').slice(0, 100)
				);
				await message.reply({ embeds: [{ color: EMBED_COLOR, title: '📡 Broadcast Results', description: lines.join('\n') || 'No servers' }] });
			} catch (err) {
				await message.reply('❌ Broadcast failed: ' + (err.message || err));
			}
			return;
		}

		// &ban <clusterId> <playerId> [reason...]
		if (cmd === 'ban' && isAdmin) {
			const clusterId = parseInt(args[0], 10);
			const playerId = args[1];
			const reason = args.slice(2).join(' ') || 'Banned by admin';
			if (!clusterId || !playerId) {
				return message.reply('Usage: `' + prefix + 'ban <clusterId> <playerId> [reason]`');
			}
			try {
				const data = await api.createBan({ cluster_id: clusterId, player_id: playerId, reason, banned_by: message.author.tag });
				const results = (data.sync_results || []).map((r) => (r.success ? '✅' : '❌') + ' ' + r.server);
				await message.reply({ embeds: [{ color: 0xe74c3c, title: '🔨 Player Banned', fields: [
					{ name: 'Player ID', value: playerId, inline: true },
					{ name: 'Reason', value: reason, inline: true },
					{ name: 'Sync', value: results.join('\n') || 'No servers' },
				] }] });
			} catch (err) {
				await message.reply('❌ Ban failed: ' + (err.message || err));
			}
			return;
		}

		// &unban <banId>
		if (cmd === 'unban' && isAdmin) {
			const banId = parseInt(args[0], 10);
			if (!banId) return message.reply('Usage: `' + prefix + 'unban <banId>`');
			try {
				await api.removeBan(banId);
				await message.reply('✅ Ban removed and synced across servers.');
			} catch (err) {
				await message.reply('❌ Unban failed: ' + (err.message || err));
			}
			return;
		}

		// &bans [clusterId]
		if (cmd === 'bans' && isAdmin) {
			const clusterId = args[0] ? parseInt(args[0], 10) : null;
			try {
				const data = await api.bans(clusterId);
				const bans = data.bans || [];
				if (bans.length === 0) return message.reply('No active bans.');
				const lines = bans.slice(0, 20).map((b) => '`#' + b.id + '` **' + (b.player_name || b.player_id) + '** — ' + (b.reason || 'No reason'));
				await message.reply({ embeds: [{ color: 0xe74c3c, title: '🔨 Active Bans (' + bans.length + ')', description: lines.join('\n') }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &schedule <serverId|clusterId> <cron> <command...>
		if (cmd === 'schedule' && isAdmin) {
			if (args[0] === 'list') {
				try {
					const data = await api.scheduledCommands();
					const cmds = data.commands || [];
					if (cmds.length === 0) return message.reply('No scheduled commands.');
					const lines = cmds.map((c) => '`#' + c.id + '` `' + c.cron_expression + '` ' + c.command.slice(0, 80));
					await message.reply({ embeds: [{ color: EMBED_COLOR, title: '⏰ Scheduled Commands', description: lines.join('\n') }] });
				} catch (err) {
					await message.reply('❌ ' + (err.message || err));
				}
				return;
			}
			if (args[0] === 'remove') {
				const id = parseInt(args[1], 10);
				if (!id) return message.reply('Usage: `' + prefix + 'schedule remove <id>`');
				try {
					await api.deleteScheduledCommand(id);
					await message.reply('✅ Scheduled command #' + id + ' removed.');
				} catch (err) {
					await message.reply('❌ ' + (err.message || err));
				}
				return;
			}
			// schedule add: &schedule <serverId> "<cron>" <command>
			const serverId = parseInt(args[0], 10);
			const cronMatch = args.slice(1).join(' ').match(/^"([^"]+)"\s+(.+)$/);
			if (!serverId || !cronMatch) {
				return message.reply('Usage: `' + prefix + 'schedule <serverId> "<cron expression>" <command>`\nOr: `' + prefix + 'schedule list` / `' + prefix + 'schedule remove <id>`');
			}
			try {
				const data = await api.createScheduledCommand({
					server_id: serverId,
					cron_expression: cronMatch[1],
					command: cronMatch[2],
					description: 'Created by ' + message.author.tag,
					created_by_discord_id: message.author.id,
				});
				await message.reply('✅ Scheduled command #' + data.command.id + ' created.');
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &players [clusterId]
		if (cmd === 'players' || cmd === 'online') {
			const clusterId = args[0] ? parseInt(args[0], 10) : null;
			try {
				const data = await api.listAllPlayers(clusterId);
				const players = data.players || [];
				if (players.length === 0) return message.reply('No players online.');
				const byServer = {};
				for (const p of players) {
					const key = p.server_name || 'Unknown';
					if (!byServer[key]) byServer[key] = [];
					byServer[key].push(p.name);
				}
				const fields = Object.entries(byServer).map(([server, names]) => ({
					name: server + ' (' + names.length + ')',
					value: names.join(', ').slice(0, 1024),
				}));
				await message.reply({ embeds: [{ color: EMBED_COLOR, title: '👥 Online Players (' + players.length + ')', fields }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &servers
		if (cmd === 'servers') {
			try {
				const data = await api.servers();
				const servers = data.servers || [];
				const lines = servers.map((s) => '`#' + s.id + '` **' + s.name + '** — ' + (s.map_name || 'Unknown map'));
				await message.reply({ embeds: [{ color: EMBED_COLOR, title: '🖥️ Servers (' + servers.length + ')', description: lines.join('\n') || 'No servers configured' }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
		}
	};
}

module.exports = { createServerManagementHandler };
