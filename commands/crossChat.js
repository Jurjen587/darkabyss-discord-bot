'use strict';

const EMBED_COLOR = 0x2ecc71;

/**
 * Cross-Chat: relays game chat to Discord and Discord messages to game servers.
 */
function createCrossChatHandler({ api, client }) {
	if (!api) return null;

	let configs = [];
	let pollTimers = [];
	let serverMap = {};

	async function loadConfigs() {
		try {
			const data = await api.chatBridgeConfigs();
			configs = data.configs || [];

			const serversData = await api.servers();
			serverMap = {};
			for (const s of (serversData.servers || [])) {
				serverMap[s.id] = s;
			}
		} catch (err) {
			console.error('[CrossChat] Failed to load configs:', err.message || err);
		}
	}

	async function pollServer(serverId, channelId, clusterId) {
		try {
			const data = await api.pollChat(serverId);
			const messages = data.messages || [];
			if (messages.length === 0) return;

			const channel = await client.channels.fetch(channelId).catch(() => null);
			if (!channel) return;

			const server = serverMap[serverId];
			const serverLabel = server ? server.name : 'Server ' + serverId;

			for (const msg of messages) {
				if (msg.player_name && !msg.player_name.startsWith('[Discord]')) {
					await channel.send({
						embeds: [{
							color: EMBED_COLOR,
							description: '**' + msg.player_name + '** (' + serverLabel + '): ' + msg.message,
						}],
					}).catch(() => {});

					// Relay between servers in the cluster
					if (clusterId) {
						await api.broadcastChat(clusterId, msg.player_name, msg.message, serverId).catch(() => {});
					}
				}
			}
		} catch (err) {
			// Silently skip poll failures
		}
	}

	async function start() {
		await loadConfigs();

		for (const config of configs) {
			if (!config.is_active || !config.discord_channel_id) continue;

			const serversData = await api.servers().catch(() => ({ servers: [] }));
			const clusterServers = (serversData.servers || []).filter((s) =>
				!config.ark_cluster_id || s.cluster_id === config.ark_cluster_id
			);

			for (const server of clusterServers) {
				const timer = setInterval(() => {
					pollServer(server.id, config.discord_channel_id, config.ark_cluster_id);
				}, 10000);
				pollTimers.push(timer);
			}
		}
	}

	// Handle Discord → Game messages
	async function handleMessage(message) {
		if (!message || !message.author || message.author.bot) return;

		const config = configs.find((c) => c.discord_channel_id === message.channel.id && c.is_active && c.relay_to_game);
		if (!config) return;

		const senderName = message.member?.displayName || message.author.username;
		const text = message.content.slice(0, 256);
		if (!text) return;

		if (config.ark_cluster_id) {
			await api.broadcastChat(config.ark_cluster_id, senderName, text).catch((err) => {
				console.error('[CrossChat] Broadcast failed:', err.message || err);
			});
		}
	}

	function stop() {
		for (const timer of pollTimers) clearInterval(timer);
		pollTimers = [];
	}

	return { start, handleMessage, stop };
}

module.exports = { createCrossChatHandler };
