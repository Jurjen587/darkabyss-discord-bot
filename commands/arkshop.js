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

function encodeCtx(obj) {
	return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function decodeCtx(value) {
	try {
		const raw = Buffer.from(String(value || ''), 'base64url').toString('utf8');
		return JSON.parse(raw);
	} catch {
		return null;
	}
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
	return buildCategoryPageMessage(categories, 0);
}

function buildCategoryPageMessage(categories, page) {
	const pageSize = 4;
	const safePage = Math.max(0, Number.isInteger(page) ? page : 0);
	const totalPages = Math.max(1, Math.ceil(categories.length / pageSize));
	const clampedPage = Math.min(safePage, totalPages - 1);
	const start = clampedPage * pageSize;
	const visible = categories.slice(start, start + pageSize);

	const selectRow = new MessageActionRow();
	for (let i = 0; i < pageSize; i += 1) {
		const cat = visible[i];
		const ctx = cat ? encodeCtx({ page: clampedPage, catId: cat.id, catName: cat.name }) : encodeCtx({ page: clampedPage });
		selectRow.addComponents(
			new MessageButton()
				.setCustomId('arkshop:catn:' + (i + 1) + ':' + ctx)
				.setLabel(String(i + 1))
				.setStyle('PRIMARY')
				.setDisabled(!cat)
		);
	}

	const components = [selectRow];
	if (totalPages > 1) {
		const navRow = new MessageActionRow().addComponents(
			new MessageButton()
				.setCustomId('arkshop:cats:page:' + Math.max(0, clampedPage - 1) + ':prev')
				.setLabel('◀ Prev')
				.setStyle('SECONDARY')
				.setDisabled(clampedPage <= 0),
			new MessageButton()
				.setCustomId('arkshop:cats:page:' + Math.min(totalPages - 1, clampedPage + 1) + ':next')
				.setLabel('Next ▶')
				.setStyle('SECONDARY')
				.setDisabled(clampedPage >= totalPages - 1)
		);
		components.push(navRow);
	}

	const catFields = visible.map((cat, i) => ({
		name: String(i + 1) + '.  ' + (cat ? cat.name : '—'),
		value: cat
			? (cat.package_count || 0) + ' package' + ((cat.package_count || 0) !== 1 ? 's' : '') + (cat.description ? '\n' + truncate(cat.description, 80) : '')
			: '\u200b',
		inline: true,
	}));

	// pad to even columns so Discord lays out in a 2-column grid
	if (catFields.length % 2 !== 0) {
		catFields.push({ name: '\u200b', value: '\u200b', inline: true });
	}

	return {
		embeds: [{
			title: '🛒  Dark Abyss  —  ARK Shop',
			description:
				'Press a number to open that category.' +
				(totalPages > 1 ? '  \u2014  Page **' + (clampedPage + 1) + ' / ' + totalPages + '**' : ''),
			color: EMBED_COLOR_DEFAULT,
			fields: catFields,
			footer: { text: 'DarkAbyss ARK Shop' },
			timestamp: new Date().toISOString(),
		}],
		components,
	};
}

function buildPackageMessage(packages, catId, catName) {
	return buildPackagePageMessage(packages, catId, catName, 0);
}

function buildPackagePageMessage(packages, catId, catName, page) {
	const pageSize = 4;
	const safePage = Math.max(0, Number.isInteger(page) ? page : 0);
	const totalPages = Math.max(1, Math.ceil(packages.length / pageSize));
	const clampedPage = Math.min(safePage, totalPages - 1);
	const start = clampedPage * pageSize;
	const visible = packages.slice(start, start + pageSize);

	const selectRow = new MessageActionRow();
	for (let i = 0; i < pageSize; i += 1) {
		const pkg = visible[i];
		const ctx = pkg
			? encodeCtx({ page: clampedPage, pkgId: pkg.id, catId, catName })
			: encodeCtx({ page: clampedPage, catId, catName });
		selectRow.addComponents(
			new MessageButton()
				.setCustomId('arkshop:pkgn:' + (i + 1) + ':' + ctx)
				.setLabel(String(i + 1))
				.setStyle('SUCCESS')
				.setDisabled(!pkg)
		);
	}

	const backButton = new MessageButton()
		.setCustomId('arkshop:cats')
		.setLabel('← Categories')
		.setStyle('SECONDARY');

	let navRow;
	if (totalPages > 1) {
		navRow = new MessageActionRow().addComponents(
			new MessageButton()
				.setCustomId('arkshop:catpage:' + catId + ':prev:' + encodeCtx({ catName, page: Math.max(0, clampedPage - 1) }))
				.setLabel('◀ Prev')
				.setStyle('SECONDARY')
				.setDisabled(clampedPage <= 0),
			new MessageButton()
				.setCustomId('arkshop:catpage:' + catId + ':next:' + encodeCtx({ catName, page: Math.min(totalPages - 1, clampedPage + 1) }))
				.setLabel('Next ▶')
				.setStyle('SECONDARY')
				.setDisabled(clampedPage >= totalPages - 1),
			backButton
		);
	} else {
		navRow = new MessageActionRow().addComponents(backButton);
	}

	const pkgFields = visible.map((pkg, i) => ({
		name: String(i + 1) + '.  ' + (pkg ? pkg.name : '—'),
		value: pkg
			? '💰 ' + formatCredits(pkg.price_credits) + (pkg.description ? '\n' + truncate(pkg.description, 80) : '')
			: '\u200b',
		inline: true,
	}));

	if (pkgFields.length % 2 !== 0) {
		pkgFields.push({ name: '\u200b', value: '\u200b', inline: true });
	}

	return {
		embeds: [{
			title: '📦  ' + catName,
			description:
				'Press a number to view details and buy.' +
				(totalPages > 1 ? '  \u2014  Page **' + (clampedPage + 1) + ' / ' + totalPages + '**' : ''),
			color: EMBED_COLOR_DEFAULT,
			fields: pkgFields,
			footer: { text: 'DarkAbyss ARK Shop' },
			timestamp: new Date().toISOString(),
		}],
		components: [selectRow, navRow],
	};
}

function buildPackageDetailMessage(pkg, catId, catName, commandPrefix) {
	const fields = [
		{ name: '💰 Price', value: formatCredits(pkg.price_credits), inline: false },
	];
	if (pkg.description) {
		fields.unshift({ name: '📋 Description', value: pkg.description, inline: false });
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

		// ── Set EOS ID / Specimen ──
		if (sub === 'set') {
			const field = (parts[2] || '').toLowerCase();
			const value = parts.slice(3).join(' ').trim();

			if (field !== 'eosid' && field !== 'specimen') {
				await message.reply({
					embeds: [{
						title: '🛒 ARK Shop — Set Profile',
						description: [
							'Save your EOS ID and character name so you can buy with one click.',
							'',
							'`' + commandPrefix + 'arkshop set eosid <YOUR_EOS_ID>`',
							'`' + commandPrefix + 'arkshop set specimen <YOUR_SPECIMEN_NAME>`',
						].join('\n'),
						color: EMBED_COLOR_DEFAULT,
						footer: { text: 'DarkAbyss ARK Shop' },
						timestamp: new Date().toISOString(),
					}],
					allowedMentions: { repliedUser: false },
				});
				return;
			}

			if (!value) {
				const label = field === 'eosid' ? 'EOS ID' : 'Specimen name';
				await message.reply({
					content: '❌ Please provide a value. Example: `' + commandPrefix + 'arkshop set ' + field + ' YOUR_VALUE_HERE`',
					allowedMentions: { repliedUser: false },
				});
				return;
			}

			try {
				const payload = {
					discord_id:       message.author.id,
					discord_username: message.author.tag || message.author.username,
				};
				if (field === 'eosid')    payload.eos_id   = value;
				if (field === 'specimen') payload.specimen = value;

				await requestJson('POST', '/users', payload);

				const fieldLabel = field === 'eosid' ? 'EOS ID' : 'Specimen';
				await message.reply({
					embeds: [{
						title: '✅ ' + fieldLabel + ' saved',
						description: 'Your **' + fieldLabel + '** has been set to:\n`' + value + '`\n\nYou can now buy packages with a single click on the **🛒 Buy Now** button.',
						color: EMBED_COLOR_SUCCESS,
						footer: { text: 'DarkAbyss ARK Shop' },
						timestamp: new Date().toISOString(),
					}],
					allowedMentions: { repliedUser: false },
				});
			} catch (err) {
				await message.reply({
					content: '❌ ' + (err.message || 'Failed to save your settings.'),
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
					'`' + commandPrefix + 'arkshop` — Browse the shop',
					'`' + commandPrefix + 'arkshop set eosid <EOS_ID>` — Save your EOS ID',
					'`' + commandPrefix + 'arkshop set specimen <NAME>` — Save your character name',
					'',
					'Once your EOS ID and specimen are saved, press **🛒 Buy Now** on any package to purchase instantly.',
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
				const page = Number.parseInt(parts[3] || '0', 10);
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
				await interaction.editReply(buildCategoryPageMessage(categories, Number.isInteger(page) ? page : 0));
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

		if (action === 'catn') {
			const ctx = decodeCtx(parts.slice(3).join(':'));
			if (!ctx || !ctx.catId || !ctx.catName) {
				await interaction.reply({ content: '❌ That category button is no longer valid. Open the shop again.', ephemeral: true });
				return;
			}
			await interaction.deferUpdate();
			try {
				const data = await requestJson('GET', '/packages?category_id=' + ctx.catId);
				const packages = Array.isArray(data.packages) ? data.packages : [];
				if (packages.length === 0) {
					await interaction.editReply({
						embeds: [{
							title: '📦 ' + ctx.catName,
							description: '📭 No packages in this category.',
							color: EMBED_COLOR_DEFAULT,
							footer: { text: 'DarkAbyss ARK Shop' },
							timestamp: new Date().toISOString(),
						}],
						components: [
							new MessageActionRow().addComponents(
								new MessageButton()
									.setCustomId('arkshop:cats:page:' + (Number.isInteger(ctx.page) ? ctx.page : 0))
									.setLabel('← Back to Categories')
									.setStyle('SECONDARY')
							),
						],
					});
					return;
				}
				await interaction.editReply(buildPackagePageMessage(packages, String(ctx.catId), String(ctx.catName), 0));
			} catch (err) {
				await interaction.editReply({ content: '❌ ' + err.message, embeds: [], components: [] });
			}
			return;
		}

		if (action === 'catpage') {
			const catId = parts[2];
			// parts[3] is the direction marker (prev/next), encoded context starts at parts[4]
			const ctx = decodeCtx(parts.slice(4).join(':'));
			if (!ctx || !ctx.catName) {
				await interaction.reply({ content: '❌ That page button is no longer valid. Open the shop again.', ephemeral: true });
				return;
			}
			await interaction.deferUpdate();
			try {
				const data = await requestJson('GET', '/packages?category_id=' + catId);
				const packages = Array.isArray(data.packages) ? data.packages : [];
				await interaction.editReply(buildPackagePageMessage(packages, String(catId), String(ctx.catName), Number.isInteger(ctx.page) ? ctx.page : 0));
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

		if (action === 'pkgn') {
			const ctx = decodeCtx(parts.slice(3).join(':'));
			if (!ctx || !ctx.pkgId || !ctx.catId || !ctx.catName) {
				await interaction.reply({ content: '❌ That package button is no longer valid. Open the category again.', ephemeral: true });
				return;
			}
			await interaction.deferUpdate();
			try {
				const pkg = await requestJson('GET', '/packages/' + ctx.pkgId);
				await interaction.editReply(buildPackageDetailMessage(pkg, String(ctx.catId), String(ctx.catName), commandPrefix));
			} catch (err) {
				await interaction.editReply({ content: '❌ ' + err.message, embeds: [], components: [] });
			}
			return;
		}

		// ── Buy Now button: auto-lookup user, then purchase ──
		if (action === 'buy') {
			const pkgId = parts[2];
			await interaction.deferReply({ ephemeral: true });
			try {
				// Look up the user's saved EOS ID + specimen
				let discordUser = null;
				try {
					discordUser = await requestJson('GET', '/users/' + interaction.user.id);
				} catch (userErr) {
					// Only swallow 404 (user not found yet); re-throw everything else (429, 500, etc.)
					if (!userErr.message || !userErr.message.includes('404')) {
						throw userErr;
					}
				}

				const missing = [];
				if (!discordUser?.eos_id)   missing.push('EOS ID  →  `' + commandPrefix + 'arkshop set eosid <YOUR_EOS_ID>`');
				if (!discordUser?.specimen) missing.push('Specimen  →  `' + commandPrefix + 'arkshop set specimen <YOUR_SPECIMEN_NAME>`');

				if (missing.length > 0) {
					await interaction.editReply({
						embeds: [{
							title: '⚠️ Profile incomplete',
							description: 'Before you can buy, save the following:\n\n' + missing.join('\n'),
							color: EMBED_COLOR_ERROR,
							footer: { text: 'DarkAbyss ARK Shop — only you can see this' },
							timestamp: new Date().toISOString(),
						}],
					});
					return;
				}

				const payload = await requestJson('POST', '/purchase', {
					package_id:       Number(pkgId),
					discord_user_id:  interaction.user.id,
					discord_username: interaction.user.tag || interaction.user.username,
					eos_id:           discordUser.eos_id,
					specimen:         discordUser.specimen,
				});

				await interaction.editReply({
					embeds: [{
						title: '✅ Purchase confirmed!',
						description: 'Your order is queued. The bot will scan the cluster and deliver to the server where you are online.',
						color: EMBED_COLOR_SUCCESS,
						fields: [
							{ name: '📦 Package',  value: String(payload.package_name || '—'), inline: true },
							{ name: '💰 Price',    value: formatCredits(payload.price_credits || 0), inline: true },
							{ name: '🆔 Order ID', value: String(payload.order_id || '—'),      inline: true },
						],
						footer: { text: 'DarkAbyss ARK Shop — only you can see this' },
						timestamp: new Date().toISOString(),
					}],
				});
			} catch (err) {
				await interaction.editReply({ content: '❌ ' + (err.message || 'Purchase failed.') });
			}
			return;
		}
	};
}

module.exports = {
	createArkShopCommandHandler,
	createArkShopInteractionHandler,
};
