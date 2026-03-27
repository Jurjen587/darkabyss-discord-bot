const { Permissions } = require('discord.js');

function createBalanceCommandHandler(options) {
	const commandPrefix = options.commandPrefix;
	const balanceStartingAmount = options.balanceStartingAmount;
	const adminUserIds = options.adminUserIds;
	const defaultEmbedColor = 15859730;

	const { balances, normalizeAmount, getBalance: storeGetBalance, setBalance } = require('./balanceStore');

	function getBalance(userId) {
		return storeGetBalance(userId, balanceStartingAmount);
	}

	function parseAmount(raw) {
		const value = Number.parseFloat(raw);
		if (!Number.isFinite(value)) {
			return null;
		}

		return normalizeAmount(value);
	}

	function formatAmount(amount) {
		return normalizeAmount(amount).toLocaleString('en-US', {
			minimumFractionDigits: 0,
			maximumFractionDigits: 2,
		});
	}

	function parseUserArgument(rawValue, message) {
		if (!rawValue) {
			return null;
		}

		if (message.mentions.users.size > 0) {
			return message.mentions.users.first();
		}

		const id = rawValue.replace(/[<@!>]/g, '');
		if (!/^\d{15,25}$/.test(id)) {
			return null;
		}

		return message.client.users.cache.get(id) || null;
	}

	function isBalanceAdmin(message) {
		if (adminUserIds.has(message.author.id)) {
			return true;
		}

		if (message.member && message.member.permissions && message.member.permissions.has(Permissions.FLAGS.ADMINISTRATOR)) {
			return true;
		}

		return false;
	}

	async function replyWithEmbed(message, payload) {
		const embed = {
			title: payload.title || 'Balance',
			color: payload.color || defaultEmbedColor,
			description: payload.description || undefined,
			fields: payload.fields || undefined,
			footer: {
				text: 'DarkAbyss Balance System',
			},
			timestamp: new Date().toISOString(),
		};

		await message.reply({
			content: payload.content || undefined,
			allowedMentions: payload.allowedMentions || undefined,
			embeds: [embed],
		});
	}

	function buildHelpFields(message) {
		const isAdmin = isBalanceAdmin(message);
		const fields = [
			{
				name: 'Balance Commands',
				value: [
					'`' + commandPrefix + 'bal`',
					'`' + commandPrefix + 'bal @user`',
					'`' + commandPrefix + 'bal transfer @user amount`',
					'`' + commandPrefix + 'baltop`',
					'`' + commandPrefix + 'bal help`',
				].join('\n'),
				inline: false,
			},
		];

		if (isAdmin) {
			fields.push({
				name: 'Admin Commands',
				value: [
					'`' + commandPrefix + 'bal set @user amount`',
					'`' + commandPrefix + 'bal add @user amount`',
					'`' + commandPrefix + 'bal remove @user amount`',
				].join('\n'),
				inline: false,
			});
		}

		return fields;
	}

	async function showTopBalances(message) {
		const topEntries = Object.entries(balances)
			.map(([userId, amount]) => [userId, Number(amount)])
			.filter(([, amount]) => Number.isFinite(amount) && amount > 0)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 10);

		if (topEntries.length === 0) {
			await replyWithEmbed(message, {
				title: 'Balance Top 10',
				description: 'No balances yet.',
			});
			return;
		}

		const lines = topEntries.map(([userId, amount], index) => {
			const member = message.guild ? message.guild.members.cache.get(userId) : null;
			const name = member ? member.user.username : 'User ' + userId;
			return String(index + 1).padStart(2, ' ') + '. ' + name + ' - ' + formatAmount(amount);
		});

		await replyWithEmbed(message, {
			title: 'Balance Top 10',
			description: lines.join('\n'),
		});
	}

	return async function handleBalanceCommand(message) {
		const content = (message.content || '').trim();
		if (!content.startsWith(commandPrefix)) {
			return;
		}

		if (content === commandPrefix) {
			await replyWithEmbed(message, {
				title: 'Command Suggestion',
				description: 'Try `' + commandPrefix + 'bal help` or `' + commandPrefix + 'baltop`.',
			});
			return;
		}

		const parts = content.split(/\s+/);
		const baseCommand = (parts[0] || '').toLowerCase();
		const balBase = (commandPrefix + 'bal').toLowerCase();
		const balanceBase = (commandPrefix + 'balance').toLowerCase();
		const topBase = (commandPrefix + 'baltop').toLowerCase();

		if (baseCommand === topBase) {
			await showTopBalances(message);
			return;
		}

		if (baseCommand !== balBase && baseCommand !== balanceBase) {
			return;
		}

		const subCommand = (parts[1] || '').toLowerCase();

		if (!subCommand) {
			const targetUser = message.mentions.users.first() || message.author;
			const amount = getBalance(targetUser.id);
			await replyWithEmbed(message, {
				title: 'Balance',
				description: targetUser.id === message.author.id
					? 'Your balance is **' + formatAmount(amount) + '**.'
					: targetUser.username + ' has **' + formatAmount(amount) + '**.',
			});
			return;
		}

		if (subCommand.startsWith('<@') || /^\d{15,25}$/.test(subCommand)) {
			const targetUser = parseUserArgument(parts[1], message);
			if (!targetUser || targetUser.bot) {
				await replyWithEmbed(message, {
					title: 'Invalid Usage',
					description: 'Usage: `' + commandPrefix + 'bal @user`',
					color: 15158332,
				});
				return;
			}

			const amount = getBalance(targetUser.id);
			await replyWithEmbed(message, {
				title: 'Balance',
				description: targetUser.username + ' has **' + formatAmount(amount) + '**.',
			});
			return;
		}

		if (subCommand === 'transfer') {
			const targetUser = parseUserArgument(parts[2], message);
			const amount = parseAmount(parts[3]);

			if (!targetUser || targetUser.bot) {
				await replyWithEmbed(message, {
					title: 'Invalid Usage',
					description: 'Usage: `' + commandPrefix + 'bal transfer @user amount`',
					color: 15158332,
				});
				return;
			}

			if (!Number.isFinite(amount) || amount <= 0) {
				await replyWithEmbed(message, {
					title: 'Invalid Amount',
					description: 'Transfer amount must be a number greater than 0.',
					color: 15158332,
				});
				return;
			}

			if (targetUser.id === message.author.id) {
				await replyWithEmbed(message, {
					title: 'Invalid Transfer',
					description: 'You cannot transfer balance to yourself.',
					color: 15158332,
				});
				return;
			}

			const senderBalance = getBalance(message.author.id);
			if (senderBalance < amount) {
				await replyWithEmbed(message, {
					title: 'Insufficient Balance',
					description: 'You have **' + formatAmount(senderBalance) + '**.',
					color: 15158332,
				});
				return;
			}

			setBalance(message.author.id, senderBalance - amount);
			setBalance(targetUser.id, getBalance(targetUser.id) + amount);

			await replyWithEmbed(message, {
				title: 'Transfer Complete',
				description: 'Transferred **' + formatAmount(amount) + '** to ' + targetUser.toString() + '.',
				fields: [
					{
						name: 'Your New Balance',
						value: formatAmount(getBalance(message.author.id)),
						inline: true,
					},
					{
						name: targetUser.username + ' Balance',
						value: formatAmount(getBalance(targetUser.id)),
						inline: true,
					},
				],
			});
			return;
		}

		if (subCommand === 'set' || subCommand === 'add' || subCommand === 'remove') {
			if (!isBalanceAdmin(message)) {
				await replyWithEmbed(message, {
					title: 'Permission Denied',
					description: 'You need admin permissions to use this command.',
					color: 15158332,
				});
				return;
			}

			const targetUser = parseUserArgument(parts[2], message);
			const amount = parseAmount(parts[3]);

			if (!targetUser || targetUser.bot) {
				await replyWithEmbed(message, {
					title: 'Invalid Usage',
					description: 'Usage: `' + commandPrefix + 'bal ' + subCommand + ' @user amount`',
					color: 15158332,
				});
				return;
			}

			if (!Number.isFinite(amount) || amount < 0) {
				await replyWithEmbed(message, {
					title: 'Invalid Amount',
					description: 'Amount must be a number of 0 or higher.',
					color: 15158332,
				});
				return;
			}

			let nextBalance = getBalance(targetUser.id);
			if (subCommand === 'set') {
				nextBalance = amount;
			}

			if (subCommand === 'add') {
				nextBalance += amount;
			}

			if (subCommand === 'remove') {
				nextBalance = Math.max(0, nextBalance - amount);
			}

			setBalance(targetUser.id, nextBalance);
			await replyWithEmbed(message, {
				title: 'Admin Balance Update',
				description: targetUser.toString() + ' now has **' + formatAmount(nextBalance) + '**.',
			});
			return;
		}

		if (subCommand === 'top' || subCommand === 'leaderboard') {
			await showTopBalances(message);
			return;
		}

		if (subCommand === 'help') {
			await replyWithEmbed(message, {
				title: 'Balance Help',
				fields: buildHelpFields(message),
			});
			return;
		}

		await replyWithEmbed(message, {
			title: 'Unknown Command',
			description: 'Use `' + commandPrefix + 'bal help`.',
			color: 15158332,
		});
	};
}

module.exports = {
	createBalanceCommandHandler,
};