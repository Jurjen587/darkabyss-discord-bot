const path = require('path');
const fs = require('fs');
const { Permissions } = require('discord.js');

function createBalanceCommandHandler(options) {
	const commandPrefix = options.commandPrefix;
	const balanceStartingAmount = options.balanceStartingAmount;
	const adminUserIds = options.adminUserIds;
	const defaultEmbedColor = 15859730;
	const activeBlackjackGames = new Map();

	const dataDir = path.join(__dirname, '..', 'data');
	const balancesPath = path.join(dataDir, 'balances.json');

	function ensureDataFiles() {
		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true });
		}

		if (!fs.existsSync(balancesPath)) {
			fs.writeFileSync(balancesPath, JSON.stringify({}, null, 2) + '\n', 'utf8');
		}
	}

	function readBalances() {
		ensureDataFiles();

		try {
			const raw = fs.readFileSync(balancesPath, 'utf8');
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed;
			}
		} catch (error) {
			console.error('Failed to read balances.json, starting with empty balances:', error.message || error);
		}

		return {};
	}

	function writeBalances(balances) {
		ensureDataFiles();
		fs.writeFileSync(balancesPath, JSON.stringify(balances, null, 2) + '\n', 'utf8');
	}

	let balances = readBalances();

	function normalizeAmount(value) {
		return Math.round(value * 100) / 100;
	}

	function getBalance(userId) {
		const existing = Number(balances[userId]);
		if (Number.isFinite(existing) && existing >= 0) {
			return normalizeAmount(existing);
		}

		balances[userId] = normalizeAmount(balanceStartingAmount);
		writeBalances(balances);
		return balances[userId];
	}

	function setBalance(userId, amount) {
		balances[userId] = normalizeAmount(Math.max(0, amount));
		writeBalances(balances);
		return balances[userId];
	}

	function parseAmount(raw) {
		const value = Number.parseFloat(raw);
		if (!Number.isFinite(value)) {
			return null;
		}

		return normalizeAmount(value);
	}

	function createShuffledDeck() {
		const suits = ['S', 'H', 'D', 'C'];
		const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
		const deck = [];

		for (const suit of suits) {
			for (const rank of ranks) {
				deck.push({ rank, suit });
			}
		}

		for (let i = deck.length - 1; i > 0; i -= 1) {
			const j = Math.floor(Math.random() * (i + 1));
			const temp = deck[i];
			deck[i] = deck[j];
			deck[j] = temp;
		}

		return deck;
	}

	function drawCard(deck) {
		return deck.pop();
	}

	function cardLabel(card) {
		return card.rank + card.suit;
	}

	function handValue(hand) {
		let total = 0;
		let aces = 0;

		for (const card of hand) {
			if (card.rank === 'A') {
				total += 11;
				aces += 1;
				continue;
			}

			if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') {
				total += 10;
				continue;
			}

			total += Number(card.rank);
		}

		while (total > 21 && aces > 0) {
			total -= 10;
			aces -= 1;
		}

		return total;
	}

	function cardPointValue(card) {
		if (card.rank === 'A') {
			return 11;
		}

		if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') {
			return 10;
		}

		return Number(card.rank);
	}

	function isNaturalBlackjack(hand) {
		return hand.length === 2 && handValue(hand) === 21;
	}

	function formatHand(hand) {
		return hand.map(cardLabel).join(' ');
	}

	function makeBlackjackStateEmbed(game, payload) {
		const playerTotal = handValue(game.playerHand);
		const dealerTotal = handValue(game.dealerHand);
		const hideDealer = payload.hideDealer === true;
		const dealerVisibleValue = game.dealerHand[0] ? cardPointValue(game.dealerHand[0]) : 0;

		const dealerHandText = hideDealer
			? cardLabel(game.dealerHand[0]) + ' ??'
			: formatHand(game.dealerHand);

		const dealerTitle = hideDealer
			? 'Dealer Hand (' + dealerVisibleValue + ' + ?)' 
			: 'Dealer Hand (' + dealerTotal + ')';

		const baseFields = [
			{
				name: 'Bet',
				value: formatAmount(game.bet),
				inline: true,
			},
			{
				name: 'Your Hand (' + playerTotal + ')',
				value: formatHand(game.playerHand),
				inline: false,
			},
			{
				name: dealerTitle,
				value: dealerHandText,
				inline: false,
			},
		];

		if (payload.fields && Array.isArray(payload.fields)) {
			baseFields.push(...payload.fields);
		}

		return {
			title: payload.title,
			description: payload.description,
			color: payload.color,
			fields: baseFields,
		};
	}

	function settleBlackjackGame(userId, game, outcome) {
		let payout = 0;

		if (outcome === 'blackjack') {
			payout = normalizeAmount(game.bet * 2.5);
		}

		if (outcome === 'win') {
			payout = normalizeAmount(game.bet * 2);
		}

		if (outcome === 'push') {
			payout = normalizeAmount(game.bet);
		}

		const profit = normalizeAmount(payout - game.bet);
		const updatedBalance = setBalance(userId, getBalance(userId) + payout);
		activeBlackjackGames.delete(userId);

		return {
			profit,
			updatedBalance,
		};
	}

	function resolveBlackjackGame(userId, game) {
		const playerTotal = handValue(game.playerHand);
		const dealerTotal = handValue(game.dealerHand);

		const playerNatural = isNaturalBlackjack(game.playerHand);
		const dealerNatural = isNaturalBlackjack(game.dealerHand);

		if (playerNatural && dealerNatural) {
			return {
				outcome: 'push',
				...settleBlackjackGame(userId, game, 'push'),
			};
		}

		if (playerNatural) {
			return {
				outcome: 'blackjack',
				...settleBlackjackGame(userId, game, 'blackjack'),
			};
		}

		if (dealerNatural) {
			return {
				outcome: 'lose',
				...settleBlackjackGame(userId, game, 'lose'),
			};
		}

		if (playerTotal > 21) {
			return {
				outcome: 'lose',
				...settleBlackjackGame(userId, game, 'lose'),
			};
		}

		if (dealerTotal > 21 || playerTotal > dealerTotal) {
			return {
				outcome: 'win',
				...settleBlackjackGame(userId, game, 'win'),
			};
		}

		if (playerTotal < dealerTotal) {
			return {
				outcome: 'lose',
				...settleBlackjackGame(userId, game, 'lose'),
			};
		}

		return {
			outcome: 'push',
			...settleBlackjackGame(userId, game, 'push'),
		};
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
			{
				name: 'Blackjack Commands',
				value: [
					'`' + commandPrefix + 'bj amount`',
					'`' + commandPrefix + 'bj hit`',
					'`' + commandPrefix + 'bj stand`',
					'`' + commandPrefix + 'blackjack hit`',
					'`' + commandPrefix + 'blackjack stand`',
					'`' + commandPrefix + 'blackjack amount`',
					'Example: `' + commandPrefix + 'bj 100`',
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
		const bjBase = (commandPrefix + 'bj').toLowerCase();
		const blackjackBase = (commandPrefix + 'blackjack').toLowerCase();
		const hitBase = (commandPrefix + 'hit').toLowerCase();
		const standBase = (commandPrefix + 'stand').toLowerCase();
		const bjSubCommand = (parts[1] || '').toLowerCase();
		const isBjRootCommand = baseCommand === bjBase || baseCommand === blackjackBase;

		if (baseCommand === topBase) {
			await showTopBalances(message);
			return;
		}

		if (baseCommand === hitBase || (isBjRootCommand && bjSubCommand === 'hit')) {
			const game = activeBlackjackGames.get(message.author.id);
			if (!game) {
				await replyWithEmbed(message, {
					title: 'No Active Blackjack Game',
					description: 'Start one with `' + commandPrefix + 'bj amount`.',
					color: 15158332,
				});
				return;
			}

			game.playerHand.push(drawCard(game.deck));
			const playerTotal = handValue(game.playerHand);

			if (playerTotal > 21) {
				const settled = resolveBlackjackGame(message.author.id, game);
				await replyWithEmbed(message, makeBlackjackStateEmbed(game, {
					title: 'Blackjack - Bust',
					description: 'You busted. Better luck next round.',
					color: 15158332,
					hideDealer: false,
					fields: [
						{ name: 'Outcome', value: 'You Lose', inline: true },
						{ name: 'Profit', value: formatAmount(settled.profit), inline: true },
						{ name: 'New Balance', value: formatAmount(settled.updatedBalance), inline: true },
					],
				}));
				return;
			}

			await replyWithEmbed(message, makeBlackjackStateEmbed(game, {
				title: 'Blackjack - Hit',
				description: 'Your move: `' + commandPrefix + 'bj hit` or `' + commandPrefix + 'bj stand`.',
				hideDealer: true,
			}));
			return;
		}

		if (baseCommand === standBase || (isBjRootCommand && bjSubCommand === 'stand')) {
			const game = activeBlackjackGames.get(message.author.id);
			if (!game) {
				await replyWithEmbed(message, {
					title: 'No Active Blackjack Game',
					description: 'Start one with `' + commandPrefix + 'bj amount`.',
					color: 15158332,
				});
				return;
			}

			while (handValue(game.dealerHand) < 17) {
				game.dealerHand.push(drawCard(game.deck));
			}

			const settled = resolveBlackjackGame(message.author.id, game);

			let outcomeLabel = 'Push';
			if (settled.outcome === 'blackjack') {
				outcomeLabel = 'Blackjack!';
			}
			if (settled.outcome === 'win') {
				outcomeLabel = 'You Win';
			}
			if (settled.outcome === 'lose') {
				outcomeLabel = 'You Lose';
			}

			await replyWithEmbed(message, makeBlackjackStateEmbed(game, {
				title: 'Blackjack - Final',
				description: 'Round complete.',
				hideDealer: false,
				fields: [
					{ name: 'Outcome', value: outcomeLabel, inline: true },
					{ name: 'Profit', value: (settled.profit > 0 ? '+' : '') + formatAmount(settled.profit), inline: true },
					{ name: 'New Balance', value: formatAmount(settled.updatedBalance), inline: true },
				],
			}));
			return;
		}

		if (isBjRootCommand) {
			if (bjSubCommand === 'hit' || bjSubCommand === 'stand') {
				return;
			}

			if (activeBlackjackGames.has(message.author.id)) {
				await replyWithEmbed(message, {
					title: 'Blackjack Already Running',
					description: 'Finish your round with `' + commandPrefix + 'bj hit` or `' + commandPrefix + 'bj stand` first.',
					color: 15158332,
				});
				return;
			}

			const betAmount = parseAmount(parts[1]);
			if (!Number.isFinite(betAmount) || betAmount <= 0) {
				await replyWithEmbed(message, {
					title: 'Invalid Blackjack Bet',
					description: 'Usage: `' + commandPrefix + 'bj amount` or `' + commandPrefix + 'blackjack amount`',
					color: 15158332,
				});
				return;
			}

			const currentBalance = getBalance(message.author.id);
			if (currentBalance < betAmount) {
				await replyWithEmbed(message, {
					title: 'Insufficient Balance',
					description: 'You tried to bet **' + formatAmount(betAmount) + '** but only have **' + formatAmount(currentBalance) + '**.',
					color: 15158332,
				});
				return;
			}

			setBalance(message.author.id, currentBalance - betAmount);

			const game = {
				bet: betAmount,
				deck: createShuffledDeck(),
				playerHand: [],
				dealerHand: [],
			};

			game.playerHand.push(drawCard(game.deck));
			game.dealerHand.push(drawCard(game.deck));
			game.playerHand.push(drawCard(game.deck));
			game.dealerHand.push(drawCard(game.deck));

			activeBlackjackGames.set(message.author.id, game);

			if (isNaturalBlackjack(game.playerHand) || isNaturalBlackjack(game.dealerHand)) {
				const settled = resolveBlackjackGame(message.author.id, game);

				let outcomeLabel = 'Push';
				if (settled.outcome === 'blackjack') {
					outcomeLabel = 'Blackjack!';
				}
				if (settled.outcome === 'lose') {
					outcomeLabel = 'You Lose';
				}

				await replyWithEmbed(message, makeBlackjackStateEmbed(game, {
					title: 'Blackjack - Final',
					description: 'Natural hand resolved instantly.',
					hideDealer: false,
					fields: [
						{ name: 'Outcome', value: outcomeLabel, inline: true },
						{ name: 'Profit', value: (settled.profit > 0 ? '+' : '') + formatAmount(settled.profit), inline: true },
						{ name: 'New Balance', value: formatAmount(settled.updatedBalance), inline: true },
					],
				}));
				return;
			}

			await replyWithEmbed(message, makeBlackjackStateEmbed(game, {
				title: 'Blackjack Started',
				description: 'Use `' + commandPrefix + 'bj hit` or `' + commandPrefix + 'bj stand`.',
				hideDealer: true,
				fields: [
					{
						name: 'Balance After Bet',
						value: formatAmount(getBalance(message.author.id)),
						inline: true,
					},
				],
			}));
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