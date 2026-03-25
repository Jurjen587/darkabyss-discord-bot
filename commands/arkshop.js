const https = require('https');
const { MessageActionRow, MessageButton } = require('discord.js');

const EMBED_COLOR_DEFAULT = 15859730; // orange
const EMBED_COLOR_SUCCESS = 3066993;  // green
const EMBED_COLOR_ERROR   = 15158332; // red

// ─── Helpers ────────────────────────────────────────────────────────────────

function chunkArray(arr, size) {
	const result = [];
	for (let i = 0; i < arr.length; i += size) {
		result.push(arr.slice(i, i + size));
	}
	return result;
}

function truncate(str, max) {
	return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function formatCredits(value) {
	const n = Number(value);
	return Number.isFinite(n) ? Math.round(n) + ' credits' : '0 credits';
}

function makeApiRequester(apiBaseUrl, apiToken) {
	return function requestJson(method, endpoint, payload) {
		return new Promise((resolve, reject) => {
			if (!apiBaseUrl || !apiToken) {
				reject(new Error('ARK Shop API is not configured.'));
				return;
			}

			const url = new URL(apiBaseUrl + endpoint);
			const body = payload ? JSON.stringify(payload) : '';
			const req = https.request(
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
						try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }

						if (response.statusCode < 200 || response.statusCode >= 300) {
							reject(new Error(parsed.message || 'API error (' + response.statusCode + ')'));
							return;
						}

						resolve(parsed);
					});
				}
			);

			req.on('error', (err) => reject(err));
			req.setTimeout(12000, () => req.destroy(new Error('ARK Shop API request timed out.')));
			if (body) req.write(body);
			req.end();
		});
	};
}

// ─── Message builders ────────────────────────────────────────────────────────

function buildCategoryMessage(categories) {
	const rows = [];
	for (const chunk of chunkArray(categories.slice(0, 20), 4)) {
		const row = new MessageActionRow();
		for (const cat of chunk) {
			row.addComponents(
				new MessageButton()
					.setCustomId('arkshop:cat:' + cat.id + ':' + cat.name)
					.setLabel(truncate(cat.name, 80))
					.setStyle('PRIMARY')
			);
		}
		rows.push(row);
	}

	return {
		embeds: [{
			title: '🛒 ARK Shop',
			description:
				'**' + categories.length + '** ' +
				(categories.length === 1 ? 'category' : 'categories') + ' available.\n' +
				'Select a category below to browse packages:',
			color: EMBED_COLOR_DEFAULT,
			footer: { text: 'DarkAbyss ARK Shop' },
			timestamp: new Date().toISOString(),
		}],
		components: rows,
	};
}

function buildPackageMessage(packages, catId, catName) {
	const visible = packages.slice(0, 12);
	const rows = [];

	for (const chunk of chunkArray(visible, 3)) {
		const row = new MessageActionRow();
		for (const pkg of chunk) {
			const label = truncate(pkg.name + ' — ' + formatCredits(pkg.price_credits), 80);
			row.addComponents(
				new MessageButton()
					.setCustomId('arkshop:pkg:' + pkg.id + ':' + catId + ':' + catName)
					.setLabel(label)
					.setStyle('SUCCESS')
			);
		}
		rows.push(row);
	}

	rows.push(
		new MessageActionRow().addComponents(
			new MessageButton()
				.setCustomId('arkshop:cats')
				.setLabel('← Back to Categories')
				.setStyle('SECONDARY')
		)
	);

	const countNote = visible.length === packages.length
		? '**' + packages.length + '** package(s) available.'
		: 'Showing **' + visible.length + '** of **' + packages.length + '** packages.';

	return {
		embeds: [{
			title: '📦 ' + catName,
			description: countNote + '\nClick a package to see details and buy.',
			color: EMBED_COLOR_DEFAULT,
			fields: visible.map((pkg) => ({
				name: '#' + pkg.id + ' — ' + pkg.name,
				value: formatCredits(pkg.price_credits) + ' · ' + (pkg.cluster_name || 'Any cluster'),
				inline: true,
			})),
			footer: { text: 'DarkAbyss ARK Shop' },
			timestamp: new Date().toISOString(),
		}],
		components: rows,
	};
}

function buildPackageDetailMessage(pkg, catId, catName, commandPrefix) {
	const fields = [
		{ name: '💰 Price',   value: formatCredits(pkg.price_credits),      inline: true },
		{ name: '🗺️ Cluster', value: pkg.cluster_name || 'Any cluster',      inline: true },
		{ name: '📂 Category', value: pkg.category_name || 'Uncategorised',  inline: true },
	];
	if (pkg.description) {
		fields.unshift({ name: 'Description', value: pkg.description, inline: false });
	}

	return {
		embeds: [{
			title: '📦 ' + pkg.name,
			color: EMBED_COLOR_SUCCESS,
			fields,
			footer: { text: 'DarkAbyss ARK Shop' },
			timestamp: new Date().toISOString(),
		}],
		components: [
			new MessageActionRow().addComponents(
				new MessageButton()
					.setCustomId('arkshop:buy:' + pkg.id)
					.setLabel('🛒 Buy Now')
					.setStyle('SUCCESS'),
				new MessageButton()
					.setCustomId('arkshop:cat:' + catId + ':' + catName)
					.setLabel('← Back to Packages')
					.setStyle('SECONDARY'),
				new MessageButton()
					.setCustomId('arkshop:cats')
					.setLabel('🏠 All Categories')
					.setStyle('SECONDARY')
			),
		],
	};
}

// ─── Command handler (prefix messages) ───────────────────────────────────────

function createArkShopCommandHandler(options) {
	const commandPrefix = options.commandPrefix;
	const apiBaseUrl    = (options.apiBaseUrl || '').replace(/\/+$/, '');
	const apiToken      = options.apiToken || '';
	const requestJson   = makeApiRequester(apiBaseUrl, apiToken);

	return async function handleArkShopCommand(message) {
		const content = (message.content || '').trim();
		if (!content.startsWith(commandPrefix)) return;

		const parts       = content.split(/\s+/);
		const baseCommand = (parts[0] || '').toLowerCase();
		if (baseCommand !== (commandPrefix + 'arkshop').toLowerCase()) return;

		if (!apiBaseUrl || !apiToken) {
			await message.reply({
				content: '❌ ARK Shop API is not configured.',
				allowedMentions: { repliedUser: false },
			});
			return;
		}

		const sub = (parts[1] || '').toLowerCase();

		// ── Open shop: show category buttons ──
		if (!sub || sub === 'shop') {
			try {
				const data       = await requestJson('GET', '/categories');
				const categories = Array.isArray(data.categories)
					? data.categories.filter((c) => c.package_count > 0)
					: [];

				if (categories.length === 0) {
					await message.reply({
						content: '📭 No shop categories are set up yet. Ask an admin to configure the Discord shop.',
						allowedMentions: { repliedUser: false },
					});
					return;
				}

				await message.reply({
					...buildCategoryMessage(categories),
					allowedMentions: { repliedUser: false },
				});
			} catch (err) {
				await message.reply({
					content: '❌ ' + (err.message || 'Failed to load shop.'),
					allowedMentions: { repliedUser: false },
				});
			}
			return;
		}

		// ── Buy command ──
		if (sub === 'buy') {
			const packageId = Number.parseInt(parts[2] || '', 10);
			const eosId     = (parts[3] || '').trim();
			const specimen  = parts.slice(4).join(' ').trim();

			if (!Number.isInteger(packageId) || !eosId || !specimen) {
				await message.reply({
					content: '❌ Usage: `' + commandPrefix + 'arkshop buy <packageId> <EOSID> <SPECIMEN>`',
					allowedMentions: { repliedUser: false },
				});
				return;
			}

			try {
				const payload = await requestJson('POST', '/purchase', {
					package_id:       packageId,
					discord_user_id:  message.author.id,
					discord_username: message.author.tag || message.author.username,
					eos_id:           eosId,
					specimen,
				});

				await message.reply({
					embeds: [{
						title: '✅ Purchase Created',
						description: 'Your order is queued. The bot will scan the cluster and deliver to the server where you are online.',
						color: EMBED_COLOR_SUCCESS,
						fields: [
							{ name: 'Order ID', value: String(payload.order_id || '—'),            inline: true },
							{ name: 'Package',  value: String(payload.package_name || packageId), inline: true },
							{ name: 'Price',    value: formatCredits(payload.price_credits || 0), inline: true },
							{ name: 'Cluster',  value: String(payload.cluster_name || '—'),       inline: true },
							{ name: 'EOSID',    value: eosId,                                     inline: true },
							{ name: 'Specimen', value: specimen,                                  inline: true },
						],
						footer: { text: 'DarkAbyss ARK Shop' },
						timestamp: new Date().toISOString(),
					}],
					allowedMentions: { repliedUser: false },
				});
			} catch (err) {
				await message.reply({
					content: '❌ ' + (err.message || 'Purchase failed.'),
					allowedMentions: { repliedUser: false },
				});
			}
			return;
		}

		// ── Help fallback ──
		await message.reply({
			embeds: [{
				title: '🛒 ARK Shop — Help',
				description: [
					'`' + commandPrefix + 'arkshop` — Browse packages by category',
					'`' + commandPrefix + 'arkshop buy <packageId> <EOSID> <SPECIMEN>` — Purchase a package',
				].join('\n'),
				color: EMBED_COLOR_DEFAULT,
				footer: { text: 'DarkAbyss ARK Shop' },
				timestamp: new Date().toISOString(),
			}],
			allowedMentions: { repliedUser: false },
		});
	};
}

// ─── Interaction handler (button clicks) ─────────────────────────────────────

function createArkShopInteractionHandler(options) {
	const commandPrefix = options.commandPrefix;
	const apiBaseUrl    = (options.apiBaseUrl || '').replace(/\/+$/, '');
	const apiToken      = options.apiToken || '';
	const requestJson   = makeApiRequester(apiBaseUrl, apiToken);

	return async function handleArkShopInteraction(interaction) {
		if (!interaction.isButton()) return;

		// customId format: arkshop:<action>:<...params>
		const parts  = interaction.customId.split(':');
		if (parts[0] !== 'arkshop') return;

		const action = parts[1];

		// ── Show all categories ──
		if (action === 'cats') {
			await interaction.deferUpdate();
			try {
				const data       = await requestJson('GET', '/categories');
				const categories = Array.isArray(data.categories)
					? data.categories.filter((c) => c.package_count > 0)
					: [];

				if (categories.length === 0) {
					await interaction.editReply({
						embeds: [{
							title: '🛒 ARK Shop',
							description: '📭 No categories available.',
							color: EMBED_COLOR_DEFAULT,
							footer: { text: 'DarkAbyss ARK Shop' },
							timestamp: new Date().toISOString(),
						}],
						components: [],
					});
					return;
				}
				await interaction.editReply(buildCategoryMessage(categories));
			} catch (err) {
				await interaction.editReply({ content: '❌ ' + err.message, embeds: [], components: [] });
			}
			return;
		}

		// ── Show packages for a category ──
		if (action === 'cat') {
			const catId   = parts[2];
			const catName = parts.slice(3).join(':');
			await interaction.deferUpdate();
			try {
				const data     = await requestJson('GET', '/packages?category_id=' + catId);
				const packages = Array.isArray(data.packages) ? data.packages : [];

				if (packages.length === 0) {
					await interaction.editReply({
						embeds: [{
							title: '📦 ' + catName,
							description: '📭 No packages in this category.',
							color: EMBED_COLOR_DEFAULT,
							footer: { text: 'DarkAbyss ARK Shop' },
							timestamp: new Date().toISOString(),
						}],
						components: [
							new MessageActionRow().addComponents(
								new MessageButton()
									.setCustomId('arkshop:cats')
									.setLabel('← Back to Categories')
									.setStyle('SECONDARY')
							),
						],
					});
					return;
				}

				await interaction.editReply(buildPackageMessage(packages, catId, catName));
			} catch (err) {
				await interaction.editReply({ content: '❌ ' + err.message, embeds: [], components: [] });
			}
			return;
		}

		// ── Show package detail ──
		if (action === 'pkg') {
			const pkgId   = parts[2];
			const catId   = parts[3];
			const catName = parts.slice(4).join(':');
			await interaction.deferUpdate();
			try {
				const pkg = await requestJson('GET', '/packages/' + pkgId);
				await interaction.editReply(buildPackageDetailMessage(pkg, catId, catName, commandPrefix));
			} catch (err) {
				await interaction.editReply({ content: '❌ ' + err.message, embeds: [], components: [] });
			}
			return;
		}

		// ── Show buy prompt (ephemeral, only visible to clicker) ──
		if (action === 'buy') {
			const pkgId = parts[2];
			await interaction.deferReply({ ephemeral: true });
			try {
				const pkg = await requestJson('GET', '/packages/' + pkgId);
				await interaction.editReply({
					embeds: [{
						title: '🛒 Buy — ' + pkg.name,
						description: [
							'**Price:** ' + formatCredits(pkg.price_credits),
							'**Cluster:** ' + (pkg.cluster_name || 'Any cluster'),
							'',
							'To complete your purchase, send the following command in the shop channel:',
							'```' + commandPrefix + 'arkshop buy ' + pkgId + ' <YOUR_EOSID> <SPECIMEN_NAME>```',
							'> Replace `<YOUR_EOSID>` with your EOS ID and `<SPECIMEN_NAME>` with your in-game character name.',
						].join('\n'),
						color: EMBED_COLOR_SUCCESS,
						footer: { text: 'DarkAbyss ARK Shop — only you can see this' },
						timestamp: new Date().toISOString(),
					}],
				});
			} catch (err) {
				await interaction.editReply({ content: '❌ ' + err.message });
			}
			return;
		}
	};
}

module.exports = {
	createArkShopCommandHandler,
	createArkShopInteractionHandler,
};
