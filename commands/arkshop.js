const https = require('https');

function createArkShopCommandHandler(options) {
	const commandPrefix = options.commandPrefix;
	const apiBaseUrl = (options.apiBaseUrl || '').replace(/\/+$/, '');
	const apiToken = options.apiToken || '';
	const defaultEmbedColor = 15859730;

	function requestJson(method, endpoint, payload) {
		return new Promise((resolve, reject) => {
			if (!apiBaseUrl || !apiToken) {
				reject(new Error('Arkshop API is not configured.'));
				return;
			}

			const url = new URL(apiBaseUrl + endpoint);
			const body = payload ? JSON.stringify(payload) : '';
			const request = https.request(
				url,
				{
					method,
					headers: {
						'Content-Type': 'application/json',
						'Content-Length': Buffer.byteLength(body),
						'X-Discord-Shop-Token': apiToken,
						'Accept': 'application/json',
					},
				},
				(response) => {
					const chunks = [];
					response.on('data', (chunk) => chunks.push(chunk));
					response.on('end', () => {
						const raw = Buffer.concat(chunks).toString('utf8');
						let parsed = {};
						try {
							parsed = raw ? JSON.parse(raw) : {};
						} catch {
							parsed = {};
						}

						if (response.statusCode < 200 || response.statusCode >= 300) {
							const message = parsed.message || ('Arkshop API error (' + response.statusCode + ')');
							reject(new Error(message));
							return;
						}

						resolve(parsed);
					});
				}
			);

			request.on('error', (error) => reject(error));
			request.setTimeout(12000, () => {
				request.destroy(new Error('Arkshop API request timed out.'));
			});

			if (body) {
				request.write(body);
			}

			request.end();
		});
	}

	async function replyWithEmbed(message, payload) {
		await message.reply({
			embeds: [
				{
					title: payload.title || 'ARK Shop',
					color: payload.color || defaultEmbedColor,
					description: payload.description || undefined,
					fields: payload.fields || undefined,
					footer: {
						text: 'DarkAbyss ARK Shop',
					},
					timestamp: new Date().toISOString(),
				},
			],
		});
	}

	function formatCredits(value) {
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) {
			return '0 credits';
		}

		return String(Math.round(numeric)) + ' credits';
	}

	return async function handleArkShopCommand(message) {
		const content = (message.content || '').trim();
		if (!content.startsWith(commandPrefix)) {
			return;
		}

		const parts = content.split(/\s+/);
		const baseCommand = (parts[0] || '').toLowerCase();
		if (baseCommand !== (commandPrefix + 'arkshop').toLowerCase()) {
			return;
		}

		if (!apiBaseUrl || !apiToken) {
			await replyWithEmbed(message, {
				title: 'Arkshop Not Configured',
				description: 'Set DISCORD_SHOP_API_URL and DISCORD_SHOP_API_TOKEN in bot .env.',
				color: 15158332,
			});
			return;
		}

		const subCommand = (parts[1] || '').toLowerCase();

		if (!subCommand || subCommand === 'list') {
			try {
				const payload = await requestJson('GET', '/packages');
				const packages = Array.isArray(payload.packages) ? payload.packages : [];

				if (packages.length === 0) {
					await replyWithEmbed(message, {
						title: 'ARK Shop',
						description: 'No active packages found right now.',
					});
					return;
				}

				const fields = packages.slice(0, 12).map((pkg) => ({
					name: '#' + pkg.id + ' - ' + pkg.name,
					value: [
						formatCredits(pkg.price_credits),
						'Server: ' + (pkg.server_name || 'Unknown'),
						'Cluster: ' + (pkg.cluster_name || 'Unknown'),
						pkg.description || '',
					].filter((line) => line !== '').join(' | '),
					inline: false,
				}));

				await replyWithEmbed(message, {
					title: 'ARK Shop Packages',
					description: 'Buy with `' + commandPrefix + 'arkshop buy <packageId> <EOSID> <SPECIMEN>`',
					fields,
				});
			} catch (error) {
				await replyWithEmbed(message, {
					title: 'ARK Shop Error',
					description: error.message || 'Failed to load packages.',
					color: 15158332,
				});
			}

			return;
		}

		if (subCommand === 'buy') {
			const packageId = Number.parseInt(parts[2] || '', 10);
			const eosId = (parts[3] || '').trim();
			const specimen = parts.slice(4).join(' ').trim();

			if (!Number.isInteger(packageId) || !eosId || !specimen) {
				await replyWithEmbed(message, {
					title: 'Invalid Usage',
					description: 'Usage: `' + commandPrefix + 'arkshop buy <packageId> <EOSID> <SPECIMEN>`',
					color: 15158332,
				});
				return;
			}

			try {
				const payload = await requestJson('POST', '/purchase', {
					package_id: packageId,
					discord_user_id: message.author.id,
					discord_username: message.author.tag || message.author.username,
					eos_id: eosId,
					specimen,
				});

				await replyWithEmbed(message, {
					title: 'Purchase Created',
					description: 'Your order has been created and queued for delivery.',
					fields: [
						{ name: 'Order ID', value: String(payload.order_id || '-'), inline: true },
						{ name: 'Package', value: String(payload.package_name || packageId), inline: true },
						{ name: 'Price', value: formatCredits(payload.price_credits || 0), inline: true },
						{ name: 'Server', value: String(payload.server_name || payload.server_id || '-'), inline: true },
						{ name: 'EOSID', value: eosId, inline: false },
						{ name: 'Specimen', value: specimen, inline: false },
					],
				});
			} catch (error) {
				await replyWithEmbed(message, {
					title: 'Purchase Failed',
					description: error.message || 'Could not create purchase.',
					color: 15158332,
				});
			}

			return;
		}

		await replyWithEmbed(message, {
			title: 'ARK Shop Help',
			description: [
				'`' + commandPrefix + 'arkshop`',
				'`' + commandPrefix + 'arkshop list`',
				'`' + commandPrefix + 'arkshop buy <packageId> <EOSID> <SPECIMEN>`',
			].join('\n'),
		});
	};
}

module.exports = {
	createArkShopCommandHandler,
};
