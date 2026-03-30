'use strict';

const EMBED_COLOR = 0xf1c40f;
const RARITY_COLORS = { common: 0x95a5a6, uncommon: 0x2ecc71, rare: 0x3498db, epic: 0x9b59b6, legendary: 0xf39c12 };

function createEconomyHandler({ commandPrefix, api, adminUserIds }) {
	if (!api) return async () => {};

	const prefix = commandPrefix || '&';

	return async function handleMessage(message) {
		if (!message || !message.author || message.author.bot) return;
		const content = message.content.trim();
		if (!content.startsWith(prefix)) return;

		const args = content.slice(prefix.length).trim().split(/\s+/);
		const cmd = (args.shift() || '').toLowerCase();
		const isAdmin = adminUserIds.has(message.author.id) || message.member?.permissions?.has('ADMINISTRATOR');

		// &lootbox / &lootboxes
		if (cmd === 'lootbox' || cmd === 'lootboxes') {
			if (args[0] === 'open') {
				const boxId = parseInt(args[1], 10);
				if (!boxId) return message.reply('Usage: `' + prefix + 'lootbox open <id>`');
				try {
					const { getBalance } = require('./balanceStore');
					const currentBalance = getBalance(message.author.id, 0);
					const data = await api.openLootbox(boxId, message.author.id, currentBalance);
					const { setBalance } = require('./balanceStore');
					setBalance(message.author.id, data.new_balance);
					const color = RARITY_COLORS[data.item.rarity] || EMBED_COLOR;
					await message.reply({ embeds: [{ color, title: '🎁 Lootbox Opened!', fields: [
						{ name: 'Item Won', value: '**' + data.item.name + '**', inline: true },
						{ name: 'Rarity', value: data.item.rarity, inline: true },
						{ name: 'Cost', value: data.cost + ' credits', inline: true },
						{ name: 'Balance', value: Math.round(data.new_balance) + ' credits' },
					] }] });
				} catch (err) {
					await message.reply('❌ ' + (err.message || err));
				}
				return;
			}

			try {
				const data = await api.lootboxes();
				const boxes = data.lootboxes || [];
				if (boxes.length === 0) return message.reply('No lootboxes available.');
				const lines = boxes.map((b) => '`#' + b.id + '` **' + b.name + '** — ' + b.price_credits + ' credits (' + b.item_count + ' items)');
				await message.reply({ embeds: [{ color: EMBED_COLOR, title: '🎁 Lootboxes', description: lines.join('\n'), footer: { text: 'Use ' + prefix + 'lootbox open <id> to open one' } }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &transactions / &txn
		if (cmd === 'transactions' || cmd === 'txn') {
			try {
				const data = await api.transactionHistory(message.author.id, 10);
				const txns = data.transactions || [];
				if (txns.length === 0) return message.reply('No transaction history.');
				const lines = txns.map((t) => {
					const sign = t.amount >= 0 ? '+' : '';
					return '`' + t.type + '` ' + sign + Math.round(t.amount) + ' → ' + Math.round(t.balance_after) + ' credits' + (t.description ? ' — ' + t.description : '');
				});
				await message.reply({ embeds: [{ color: EMBED_COLOR, title: '📋 Transaction History', description: lines.join('\n') }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &payday
		if (cmd === 'payday') {
			try {
				const configs = (await api.paydayConfigs()).configs || [];
				if (configs.length === 0) return message.reply('No paydays configured.');
				const config = configs[0];
				const { getBalance } = require('./balanceStore');
				const currentBalance = getBalance(message.author.id, 0);
				const data = await api.claimPayday({
					discord_user_id: message.author.id,
					payday_config_id: config.id,
					current_balance: currentBalance,
				});
				const { setBalance } = require('./balanceStore');
				setBalance(message.author.id, data.new_balance);
				await message.reply({ embeds: [{ color: 0x2ecc71, title: '💰 Payday!', description: 'You received **' + data.credits_awarded + ' credits**!\nNew balance: **' + Math.round(data.new_balance) + ' credits**' }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &discount / &discounts
		if (cmd === 'discount' || cmd === 'discounts') {
			if (args[0] === 'role' && isAdmin) {
				const roleId = args[1];
				const percent = parseInt(args[2], 10);
				if (!roleId || isNaN(percent)) return message.reply('Usage: `' + prefix + 'discount role <roleId> <percent>`');
				try {
					const roleName = message.guild?.roles?.cache?.get(roleId)?.name || null;
					await api.setRoleDiscount({ discord_role_id: roleId, role_name: roleName, discount_percent: percent });
					await message.reply('✅ Role discount set: ' + percent + '% for ' + (roleName || roleId));
				} catch (err) {
					await message.reply('❌ ' + (err.message || err));
				}
				return;
			}
			if (args[0] === 'daily' && isAdmin) {
				const day = parseInt(args[1], 10);
				const percent = parseInt(args[2], 10);
				if (isNaN(day) || isNaN(percent)) return message.reply('Usage: `' + prefix + 'discount daily <dayOfWeek 0-6> <percent>`');
				try {
					await api.setDailyDiscount({ day_of_week: day, discount_percent: percent, label: args.slice(3).join(' ') || null });
					const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
					await message.reply('✅ Daily discount: ' + percent + '% on ' + (days[day] || 'day ' + day));
				} catch (err) {
					await message.reply('❌ ' + (err.message || err));
				}
				return;
			}
			// Show current discounts
			try {
				const today = await api.todaysDiscount();
				const roles = await api.roleDiscounts();
				const fields = [];
				if (today.discount) {
					fields.push({ name: "Today's Discount", value: today.discount.discount_percent + '% off' + (today.discount.label ? ' — ' + today.discount.label : '') });
				}
				const roleList = (roles.discounts || []).map((r) => (r.role_name || r.discord_role_id) + ': ' + r.discount_percent + '%');
				if (roleList.length > 0) fields.push({ name: 'Role Discounts', value: roleList.join('\n') });
				if (fields.length === 0) return message.reply('No discounts active.');
				await message.reply({ embeds: [{ color: EMBED_COLOR, title: '🏷️ Active Discounts', fields }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
			return;
		}

		// &price <packageId>
		if (cmd === 'price') {
			const packageId = parseInt(args[0], 10);
			if (!packageId) return message.reply('Usage: `' + prefix + 'price <packageId>`');
			try {
				const roleIds = message.member?.roles?.cache?.map((r) => r.id) || [];
				const data = await api.calculatePrice(packageId, roleIds);
				const desc = data.discount_percent > 0
					? '~~' + data.base_price + ' credits~~ → **' + data.final_price + ' credits** (' + data.discount_percent + '% off)'
					: '**' + data.base_price + ' credits**';
				await message.reply({ embeds: [{ color: EMBED_COLOR, title: '💰 Price Check', description: desc }] });
			} catch (err) {
				await message.reply('❌ ' + (err.message || err));
			}
		}
	};
}

module.exports = { createEconomyHandler };
