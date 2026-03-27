const https = require('https');
const http = require('http');
const { MessageActionRow, MessageButton } = require('discord.js');
const { getBalance, setBalance } = require('./balanceStore');

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
	function singleRequest(method, endpoint, payload) {
		return new Promise((resolve, reject) => {
			if (!apiBaseUrl || !apiToken) {
				reject(new Error('ARK Shop API is not configured.'));
				return;
			}

			const url = new URL(apiBaseUrl + endpoint);
			const body = payload ? JSON.stringify(payload) : '';
			const transport = url.protocol === 'https:' ? https : http;
			const req = transport.request(
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

						if (response.statusCode === 429) {
							const retryAfter = Number(response.headers['retry-after']) || 2;
							console.error('[ArkShop API] 429 on ' + method + ' ' + endpoint + ' — retry-after: ' + retryAfter + 's — body: ' + raw.slice(0, 500));
							reject({ retryAfter, message: parsed.message || 'Rate limited' });
							return;
						}

						if (response.statusCode < 200 || response.statusCode >= 300) {
							console.error('[ArkShop API] ' + response.statusCode + ' on ' + method + ' ' + endpoint + ' — body: ' + raw.slice(0, 500));
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
	}

	return async function requestJson(method, endpoint, payload) {
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				return await singleRequest(method, endpoint, payload);
			} catch (err) {
				if (err && typeof err.retryAfter === 'number' && attempt < 2) {
					await new Promise((r) => setTimeout(r, err.retryAfter * 1000));
					continue;
				}
				throw err instanceof Error ? err : new Error(err.message || 'API request failed');
			}
		}
	};
}

// ─── Message builders ────────────────────────────────────────────────────────

function buildCategoryMessage(categories, ownerId) {
	return buildCategoryPageMessage(categories, 0, ownerId);
}

function buildCategoryPageMessage(categories, page, ownerId) {
	const pageSize = 4;
	const safePage = Math.max(0, Number.isInteger(page) ? page : 0);
	const totalPages = Math.max(1, Math.ceil(categories.length / pageSize));
	const clampedPage = Math.min(safePage, totalPages - 1);
	const start = clampedPage * pageSize;
	const visible = categories.slice(start, start + pageSize);

	const selectRow = new MessageActionRow();
	for (let i = 0; i < pageSize; i += 1) {
		const cat = visible[i];
		selectRow.addComponents(
			new MessageButton()
				.setCustomId(cat ? 'arkshop:cn:' + cat.id : 'arkshop:x:c' + i)
				.setLabel(String(i + 1))
				.setStyle('PRIMARY')
				.setDisabled(!cat)
		);
	}

	const components = [selectRow];
	if (totalPages > 1) {
		const navRow = new MessageActionRow().addComponents(
			new MessageButton()
				.setCustomId('arkshop:cs:' + Math.max(0, clampedPage - 1))
				.setLabel('◀ Prev')
				.setStyle('SECONDARY')
				.setDisabled(clampedPage <= 0),
			new MessageButton()
				.setCustomId('arkshop:cs:' + Math.min(totalPages - 1, clampedPage + 1))
				.setLabel('Next ▶')
				.setStyle('SECONDARY')
				.setDisabled(clampedPage >= totalPages - 1)
		);
		components.push(navRow);
	}

	const catLines = visible.map((cat, i) => {
		if (!cat) return '';
		const count = (cat.package_count || 0) + ' package' + ((cat.package_count || 0) !== 1 ? 's' : '');
		const desc  = cat.description ? '\n  ' + truncate(cat.description, 100) : '';
		return '**' + (i + 1) + '.  ' + cat.name + '**  ·  ' + count + desc;
	}).filter(Boolean);

	const pageNote = totalPages > 1 ? '\nPage ' + (clampedPage + 1) + ' of ' + totalPages : '';

	return {
		embeds: [{
			title: 'Dark Abyss — ARK Shop',
			description:
				'Select a category by pressing a number below.' +
				pageNote +
				'\n\n' +
				catLines.join('\n\n'),
			color: EMBED_COLOR_DEFAULT,
			footer: { text: 'DarkAbyss ARK Shop \u00b7 uid:' + ownerId },
			timestamp: new Date().toISOString(),
		}],
		components,
	};
}

function buildPackageMessage(packages, catId, catName, ownerId) {
	return buildPackagePageMessage(packages, catId, catName, 0, ownerId);
}

function buildPackagePageMessage(packages, catId, catName, page, ownerId) {
	const pageSize = 4;
	const safePage = Math.max(0, Number.isInteger(page) ? page : 0);
	const totalPages = Math.max(1, Math.ceil(packages.length / pageSize));
	const clampedPage = Math.min(safePage, totalPages - 1);
	const start = clampedPage * pageSize;
	const visible = packages.slice(start, start + pageSize);

	const selectRow = new MessageActionRow();
	for (let i = 0; i < pageSize; i += 1) {
		const pkg = visible[i];
		selectRow.addComponents(
			new MessageButton()
				.setCustomId(pkg ? 'arkshop:pn:' + pkg.id + ':' + catId : 'arkshop:x:p' + i)
				.setLabel(String(i + 1))
				.setStyle('SUCCESS')
				.setDisabled(!pkg)
		);
	}

	const backButton = new MessageButton()
		.setCustomId('arkshop:cs:0')
		.setLabel('← Categories')
		.setStyle('SECONDARY');

	let navRow;
	if (totalPages > 1) {
		navRow = new MessageActionRow().addComponents(
			new MessageButton()
				.setCustomId('arkshop:ps:' + catId + ':' + Math.max(0, clampedPage - 1))
				.setLabel('◀ Prev')
				.setStyle('SECONDARY')
				.setDisabled(clampedPage <= 0),
			new MessageButton()
				.setCustomId('arkshop:ps:' + catId + ':' + Math.min(totalPages - 1, clampedPage + 1))
				.setLabel('Next ▶')
				.setStyle('SECONDARY')
				.setDisabled(clampedPage >= totalPages - 1),
			backButton
		);
	} else {
		navRow = new MessageActionRow().addComponents(backButton);
	}

	const pkgLines = visible.map((pkg, i) => {
		if (!pkg) return '';
		const price = formatCredits(pkg.price_credits);
		const desc  = pkg.description ? '\n  ' + truncate(pkg.description, 100) : '';
		return '**' + (i + 1) + '.  ' + pkg.name + '**  ·  ' + price + desc;
	}).filter(Boolean);

	const pageNote = totalPages > 1 ? '\nPage ' + (clampedPage + 1) + ' of ' + totalPages : '';

	return {
		embeds: [{
			title: catName,
			description:
				'Select a package by pressing a number below.' +
				pageNote +
				'\n\n' +
				pkgLines.join('\n\n'),
			color: EMBED_COLOR_DEFAULT,
			footer: { text: 'DarkAbyss ARK Shop \u00b7 uid:' + ownerId },
			timestamp: new Date().toISOString(),
		}],
		components: [selectRow, navRow],
	};
}

function buildPackageDetailMessage(pkg, catId, catName, commandPrefix, ownerId) {
	const descLine = pkg.description ? pkg.description + '\n\n' : '';

	return {
		embeds: [{
			title: pkg.name,
			description: descLine + '**Price:** ' + formatCredits(pkg.price_credits),
			color: EMBED_COLOR_SUCCESS,
			footer: { text: 'DarkAbyss ARK Shop \u00b7 uid:' + ownerId },
			timestamp: new Date().toISOString(),
		}],
		components: [
			new MessageActionRow().addComponents(
				new MessageButton()
					.setCustomId('arkshop:buy:' + pkg.id)
					.setLabel('Buy Now')
					.setStyle('SUCCESS'),
				new MessageButton()
					.setCustomId('arkshop:ps:' + catId + ':0')
					.setLabel('← Back')
					.setStyle('SECONDARY'),
				new MessageButton()
					.setCustomId('arkshop:cs:0')
					.setLabel('All Categories')
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
					...buildCategoryMessage(categories, message.author.id),
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

			let pkgInfo;
			try {
				pkgInfo = await requestJson('GET', '/packages/' + packageId);
			} catch (err) {
				await message.reply({
					content: '❌ Package not found or inactive.',
					allowedMentions: { repliedUser: false },
				});
				return;
			}

			const userBalance = getBalance(message.author.id, 0);
			if (userBalance < pkgInfo.price_credits) {
				await message.reply({
					embeds: [{
						title: '❌ Insufficient credits',
						description: 'This package costs **' + formatCredits(pkgInfo.price_credits) + '** but you only have **' + formatCredits(userBalance) + '**.',
						color: EMBED_COLOR_ERROR,
						footer: { text: 'DarkAbyss ARK Shop' },
						timestamp: new Date().toISOString(),
					}],
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

				const deducted = payload.price_credits || pkgInfo.price_credits || 0;
				if (deducted > 0) {
					setBalance(message.author.id, userBalance - deducted);
				}

				await message.reply({
					embeds: [{
						title: '✅ Purchase Created',
						description: 'Your order is queued. The bot will scan the cluster and deliver to the server where you are online.',
						color: EMBED_COLOR_SUCCESS,
						fields: [
							{ name: 'Order ID',      value: String(payload.order_id || '—'),            inline: true },
							{ name: 'Package',       value: String(payload.package_name || packageId), inline: true },
							{ name: 'Price',         value: formatCredits(deducted),                    inline: true },
							{ name: 'Cluster',       value: String(payload.cluster_name || '—'),        inline: true },
							{ name: 'EOSID',         value: eosId,                                      inline: true },
							{ name: 'Specimen',      value: specimen,                                   inline: true },
							{ name: 'New Balance',   value: formatCredits(getBalance(message.author.id, 0)), inline: true },
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

		// ── Owner check: only the user who opened the shop can interact ──
		const _footer = interaction.message?.embeds?.[0]?.footer?.text || '';
		const _uidMatch = _footer.match(/uid:(\d+)/);
		const ownerId = _uidMatch ? _uidMatch[1] : null;

		if (ownerId && interaction.user.id !== ownerId) {
			await interaction.reply({
				content: '❌ Only the person who opened this shop can use these buttons.',
				ephemeral: true,
			});
			return;
		}

		// ── Show categories page ──
		if (action === 'cs') {
			const page = Number.parseInt(parts[2] || '0', 10);
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
				await interaction.editReply(buildCategoryPageMessage(categories, Number.isFinite(page) ? page : 0, ownerId));
			} catch (err) {
				await interaction.editReply({ content: '❌ ' + err.message, embeds: [], components: [] });
			}
			return;
		}

		// ── Category selected → show its packages ──
		if (action === 'cn') {
			const catId = parts[2];
			await interaction.deferUpdate();
			try {
				const [catData, pkgData] = await Promise.all([
					requestJson('GET', '/categories'),
					requestJson('GET', '/packages?category_id=' + catId),
				]);
				const categories = Array.isArray(catData.categories) ? catData.categories : [];
				const cat = categories.find((c) => String(c.id) === String(catId));
				const catName = cat ? cat.name : 'Unknown Category';
				const packages = Array.isArray(pkgData.packages) ? pkgData.packages : [];

				if (packages.length === 0) {
					await interaction.editReply({
						embeds: [{
							title: '📦 ' + catName,
							description: '📭 No packages in this category.',
							color: EMBED_COLOR_DEFAULT,
							footer: { text: 'DarkAbyss ARK Shop \u00b7 uid:' + ownerId },
							timestamp: new Date().toISOString(),
						}],
						components: [
							new MessageActionRow().addComponents(
								new MessageButton()
									.setCustomId('arkshop:cs:0')
									.setLabel('\u2190 Back to Categories')
									.setStyle('SECONDARY')
							),
						],
					});
					return;
				}

				await interaction.editReply(buildPackagePageMessage(packages, String(catId), catName, 0, ownerId));
			} catch (err) {
				await interaction.editReply({ content: '❌ ' + err.message, embeds: [], components: [] });
			}
			return;
		}

		// ── Packages page (pagination or back-to-category) ──
		if (action === 'ps') {
			const catId = parts[2];
			const page  = Number.parseInt(parts[3] || '0', 10);
			await interaction.deferUpdate();
			try {
				const [catData, pkgData] = await Promise.all([
					requestJson('GET', '/categories'),
					requestJson('GET', '/packages?category_id=' + catId),
				]);
				const categories = Array.isArray(catData.categories) ? catData.categories : [];
				const cat = categories.find((c) => String(c.id) === String(catId));
				const catName = cat ? cat.name : 'Unknown Category';
				const packages = Array.isArray(pkgData.packages) ? pkgData.packages : [];

				if (packages.length === 0) {
					await interaction.editReply({
						embeds: [{
							title: '📦 ' + catName,
							description: '📭 No packages in this category.',
							color: EMBED_COLOR_DEFAULT,
							footer: { text: 'DarkAbyss ARK Shop \u00b7 uid:' + ownerId },
							timestamp: new Date().toISOString(),
						}],
						components: [
							new MessageActionRow().addComponents(
								new MessageButton()
									.setCustomId('arkshop:cs:0')
									.setLabel('← Back to Categories')
									.setStyle('SECONDARY')
							),
						],
					});
					return;
				}

				await interaction.editReply(buildPackagePageMessage(packages, String(catId), catName, Number.isFinite(page) ? page : 0, ownerId));
			} catch (err) {
				await interaction.editReply({ content: '❌ ' + err.message, embeds: [], components: [] });
			}
			return;
		}

		// ── Package selected → show detail ──
		if (action === 'pn') {
			const pkgId = parts[2];
			const catId = parts[3];
			await interaction.deferUpdate();
			try {
				const pkg = await requestJson('GET', '/packages/' + pkgId);
				const catName = pkg.category_name || 'Unknown Category';
				await interaction.editReply(buildPackageDetailMessage(pkg, catId || String(pkg.category_id || ''), catName, commandPrefix, ownerId));
			} catch (err) {
				await interaction.editReply({ content: '❌ ' + err.message, embeds: [], components: [] });
			}
			return;
		}

		// ── Ignore placeholder/disabled buttons ──
		if (action === 'x') {
			return;
		}

		// ── Buy Now button: auto-lookup user, then purchase ──
		if (action === 'buy') {
			const pkgId = parts[2];
			await interaction.deferReply({ ephemeral: true });

			// ── Step 1: look up the user's saved profile ──
			let discordUser = null;
			try {
				discordUser = await requestJson('GET', '/users/' + interaction.user.id);
			} catch (userErr) {
				const msg = userErr.message || '';
				if (!msg.includes('404') && !msg.includes('User not found')) {
					// Non-404 error (e.g. 500, network) — surface it with context
					await interaction.editReply({ content: '❌ Could not load your profile: ' + msg });
					return;
				}
				// 404 means no profile yet — discordUser stays null, handled below
			}

			const missing = [];
			if (!discordUser?.eos_id)   missing.push('EOS ID  →  `' + commandPrefix + 'arkshop set eosid <YOUR_EOS_ID>`');
			if (!discordUser?.specimen) missing.push('Specimen  →  `' + commandPrefix + 'arkshop set specimen <YOUR_SPECIMEN_NAME>`');

			if (missing.length > 0) {
				await interaction.editReply({
					embeds: [{
						title: 'Profile incomplete',
						description: 'Before you can buy, save the following:\n\n' + missing.join('\n'),
						color: EMBED_COLOR_ERROR,
						footer: { text: 'DarkAbyss ARK Shop — only you can see this' },
						timestamp: new Date().toISOString(),
					}],
				});
				return;
			}

			// ── Step 2: check balance ──
			let pkgInfo;
			try {
				pkgInfo = await requestJson('GET', '/packages/' + pkgId);
			} catch (err) {
				await interaction.editReply({ content: '❌ Could not load package: ' + (err.message || 'unknown error') });
				return;
			}

			const userBalance = getBalance(interaction.user.id, 0);
			if (userBalance < pkgInfo.price_credits) {
				await interaction.editReply({
					embeds: [{
						title: '❌ Insufficient credits',
						description: 'This package costs **' + formatCredits(pkgInfo.price_credits) + '** but you only have **' + formatCredits(userBalance) + '**.',
						color: EMBED_COLOR_ERROR,
						footer: { text: 'DarkAbyss ARK Shop — only you can see this' },
						timestamp: new Date().toISOString(),
					}],
				});
				return;
			}

			// ── Step 3: submit the purchase ──
			try {
				const payload = await requestJson('POST', '/purchase', {
					package_id:       Number(pkgId),
					discord_user_id:  interaction.user.id,
					discord_username: interaction.user.tag || interaction.user.username,
					eos_id:           discordUser.eos_id,
					specimen:         discordUser.specimen,
				});

				const deducted = payload.price_credits || pkgInfo.price_credits || 0;
				if (deducted > 0) {
					setBalance(interaction.user.id, userBalance - deducted);
				}

				await interaction.editReply({
					embeds: [{
						title: 'Purchase confirmed!',
						description: 'Your order is queued. The bot will scan the cluster and deliver to the server where you are online.',
						color: EMBED_COLOR_SUCCESS,
						fields: [
							{ name: 'Package',     value: String(payload.package_name || '—'),         inline: true },
							{ name: 'Price',       value: formatCredits(deducted),                     inline: true },
							{ name: 'Order ID',    value: String(payload.order_id || '—'),             inline: true },
							{ name: 'New Balance', value: formatCredits(getBalance(interaction.user.id, 0)), inline: true },
						],
						footer: { text: 'DarkAbyss ARK Shop — only you can see this' },
						timestamp: new Date().toISOString(),
					}],
				});
			} catch (purchaseErr) {
				await interaction.editReply({ content: '❌ Purchase failed: ' + (purchaseErr.message || 'unknown error') });
			}
			return;
		}
	};
}

module.exports = {
	createArkShopCommandHandler,
	createArkShopInteractionHandler,
};
