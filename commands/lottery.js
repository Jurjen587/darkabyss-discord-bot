const path = require('path');
const fs = require('fs');
const { Permissions } = require('discord.js');

function createLotteryCommandHandler(options) {
	const commandPrefix = options.commandPrefix;
	const adminUserIds = options.adminUserIds;
	const defaultEmbedColor = 15859730;

	const dataDir = path.join(__dirname, '..', 'data');
	const lotteryPath = path.join(dataDir, 'lottery.json');

	function ensureDataFiles() {
		if (!fs.existsSync(dataDir)) {
			fs.mkdirSync(dataDir, { recursive: true });
		}

		if (!fs.existsSync(lotteryPath)) {
			fs.writeFileSync(lotteryPath, JSON.stringify({ active: false }, null, 2) + '\n', 'utf8');
		}
	}

	function readLotteryState() {
		ensureDataFiles();
		try {
			const parsed = JSON.parse(fs.readFileSync(lotteryPath, 'utf8'));
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed;
			}
		} catch (error) {
			console.error('Failed to read lottery state:', error.message || error);
		}

		return { active: false };
	}

	function writeLotteryState(state) {
		ensureDataFiles();
		fs.writeFileSync(lotteryPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
	}

	function isAdmin(message) {
		if (adminUserIds.has(message.author.id)) {
			return true;
		}

		if (message.member && message.member.permissions && message.member.permissions.has(Permissions.FLAGS.ADMINISTRATOR)) {
			return true;
		}

		return false;
	}

	async function replyWithEmbed(message, payload) {
		await message.reply({
			embeds: [
				{
					title: payload.title || 'Lottery',
					color: payload.color || defaultEmbedColor,
					description: payload.description || undefined,
					fields: payload.fields || undefined,
					footer: {
						text: 'DarkAbyss Lottery',
					},
					timestamp: new Date().toISOString(),
				},
			],
		});
	}

	function randomIntInclusive(min, max) {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	function parseTargetUserId(rawValue, message) {
		if (message.mentions.users.size > 0) {
			return message.mentions.users.first().id;
		}

		const raw = (rawValue || '').trim();
		const id = raw.replace(/[<@!>]/g, '');
		if (!/^\d{15,25}$/.test(id)) {
			return null;
		}

		return id;
	}

	return async function handleLotteryCommand(message) {
		const content = (message.content || '').trim();
		if (!content.startsWith(commandPrefix)) {
			return;
		}

		const parts = content.split(/\s+/);
		const baseCommand = (parts[0] || '').toLowerCase();
		if (baseCommand !== (commandPrefix + 'lottery').toLowerCase()) {
			return;
		}

		const subCommand = (parts[1] || '').toLowerCase();

		if (!subCommand || subCommand === 'help') {
			await replyWithEmbed(message, {
				title: 'Lottery Commands',
				fields: [
					{
						name: 'Player Commands',
						value: [
							'`' + commandPrefix + 'lottery info`',
							'`' + commandPrefix + 'lottery signup number`',
						].join('\n'),
						inline: false,
					},
					{
						name: 'Admin Commands',
						value: [
							'`' + commandPrefix + 'lottery start min max`',
							'`' + commandPrefix + 'lottery add @user number`',
							'`' + commandPrefix + 'lottery roll`',
						].join('\n'),
						inline: false,
					},
				],
				description: 'Signup is free. Pick one number in the active range.',
			});
			return;
		}

		if (subCommand === 'info') {
			const state = readLotteryState();
			if (!state.active) {
				await replyWithEmbed(message, {
					title: 'Lottery Info',
					description: 'No active lottery right now.',
					fields: [
						{
							name: 'How To Play',
							value: 'Wait for an admin to run `' + commandPrefix + 'lottery start min max`.',
							inline: false,
						},
					],
				});
				return;
			}

			const entries = state.entries || {};
			const ticketCount = Object.keys(entries).length;
			await replyWithEmbed(message, {
				title: 'Lottery Info',
				fields: [
					{ name: 'Range', value: String(state.min) + ' - ' + String(state.max), inline: true },
					{ name: 'Tickets', value: String(ticketCount), inline: true },
					{
						name: 'Your Number',
						value: entries[message.author.id] !== undefined ? String(entries[message.author.id]) : 'Not signed up',
						inline: true,
					},
				],
			});
			return;
		}

		if (subCommand === 'start') {
			if (!isAdmin(message)) {
				await replyWithEmbed(message, {
					title: 'Permission Denied',
					description: 'Only admins can start a lottery.',
					color: 15158332,
				});
				return;
			}

			const min = Number.parseInt(parts[2] || '', 10);
			const max = Number.parseInt(parts[3] || '', 10);
			if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max) {
				await replyWithEmbed(message, {
					title: 'Invalid Range',
					description: 'Usage: `' + commandPrefix + 'lottery start min max` (min must be lower than max).',
					color: 15158332,
				});
				return;
			}

			const state = {
				active: true,
				min,
				max,
				entries: {},
				startedBy: message.author.id,
				startedAt: new Date().toISOString(),
			};
			writeLotteryState(state);

			await replyWithEmbed(message, {
				title: 'Lottery Started',
				description: 'Players can now signup with `' + commandPrefix + 'lottery signup number`.',
				fields: [
					{ name: 'Range', value: String(min) + ' - ' + String(max), inline: true },
					{ name: 'Status', value: 'Open', inline: true },
				],
			});
			return;
		}

		if (subCommand === 'signup') {
			const state = readLotteryState();
			if (!state.active) {
				await replyWithEmbed(message, {
					title: 'Lottery Not Active',
					description: 'No active lottery. Ask an admin to start one.',
					color: 15158332,
				});
				return;
			}

			const chosen = Number.parseInt(parts[2] || '', 10);
			if (!Number.isInteger(chosen)) {
				await replyWithEmbed(message, {
					title: 'Invalid Number',
					description: 'Usage: `' + commandPrefix + 'lottery signup number`',
					color: 15158332,
				});
				return;
			}

			if (chosen < state.min || chosen > state.max) {
				await replyWithEmbed(message, {
					title: 'Out Of Range',
					description: 'Pick a number between **' + state.min + '** and **' + state.max + '**.',
					color: 15158332,
				});
				return;
			}

			const entries = state.entries || {};
			if (entries[message.author.id] !== undefined) {
				await replyWithEmbed(message, {
					title: 'Already Signed Up',
					description: 'You already picked **' + entries[message.author.id] + '** for this round.',
					color: 15158332,
				});
				return;
			}

			entries[message.author.id] = chosen;
			state.entries = entries;
			writeLotteryState(state);

			await replyWithEmbed(message, {
				title: 'Lottery Signup Confirmed',
				fields: [
					{ name: 'Your Number', value: String(chosen), inline: true },
					{ name: 'Range', value: String(state.min) + ' - ' + String(state.max), inline: true },
					{ name: 'Total Tickets', value: String(Object.keys(state.entries || {}).length), inline: true },
				],
			});
			return;
		}

		if (subCommand === 'add') {
			if (!isAdmin(message)) {
				await replyWithEmbed(message, {
					title: 'Permission Denied',
					description: 'Only admins can add players manually.',
					color: 15158332,
				});
				return;
			}

			const state = readLotteryState();
			if (!state.active) {
				await replyWithEmbed(message, {
					title: 'Lottery Not Active',
					description: 'No active lottery. Start one first.',
					color: 15158332,
				});
				return;
			}

			const targetUserId = parseTargetUserId(parts[2], message);
			const chosen = Number.parseInt(parts[3] || '', 10);
			if (!targetUserId || !Number.isInteger(chosen)) {
				await replyWithEmbed(message, {
					title: 'Invalid Usage',
					description: 'Usage: `' + commandPrefix + 'lottery add @user number`',
					color: 15158332,
				});
				return;
			}

			if (chosen < state.min || chosen > state.max) {
				await replyWithEmbed(message, {
					title: 'Out Of Range',
					description: 'Pick a number between **' + state.min + '** and **' + state.max + '**.',
					color: 15158332,
				});
				return;
			}

			const entries = state.entries || {};
			if (entries[targetUserId] !== undefined) {
				await replyWithEmbed(message, {
					title: 'Already Added',
					description: '<@' + targetUserId + '> already picked **' + entries[targetUserId] + '**.',
					color: 15158332,
				});
				return;
			}

			entries[targetUserId] = chosen;
			state.entries = entries;
			writeLotteryState(state);

			await replyWithEmbed(message, {
				title: 'Player Added',
				fields: [
					{ name: 'Player', value: '<@' + targetUserId + '>', inline: true },
					{ name: 'Number', value: String(chosen), inline: true },
					{ name: 'Total Tickets', value: String(Object.keys(entries).length), inline: true },
				],
			});
			return;
		}

		if (subCommand === 'roll') {
			if (!isAdmin(message)) {
				await replyWithEmbed(message, {
					title: 'Permission Denied',
					description: 'Only admins can roll the lottery.',
					color: 15158332,
				});
				return;
			}

			const state = readLotteryState();
			if (!state.active) {
				await replyWithEmbed(message, {
					title: 'Lottery Not Active',
					description: 'There is no active lottery to roll.',
					color: 15158332,
				});
				return;
			}

			const entries = state.entries || {};
			const participantIds = Object.keys(entries);
			if (participantIds.length === 0) {
				writeLotteryState({ active: false });
				await replyWithEmbed(message, {
					title: 'Lottery Rolled',
					description: 'No participants signed up. Lottery closed.',
					color: 15158332,
				});
				return;
			}

			const winnerSeedUserId = participantIds[Math.floor(Math.random() * participantIds.length)];
			const winningNumber = Number(entries[winnerSeedUserId]);
			const winners = participantIds.filter((userId) => Number(entries[userId]) === winningNumber);

			writeLotteryState({ active: false });

			const winnerMentions = winners.map((id) => '<@' + id + '>').join(', ');

			await replyWithEmbed(message, {
				title: 'Lottery Roll Result',
				fields: [
					{ name: 'Winning Number', value: String(winningNumber), inline: true },
					{ name: 'Participants', value: String(participantIds.length), inline: true },
					{ name: 'Winners Count', value: String(winners.length), inline: true },
					{ name: 'Winners', value: winnerMentions, inline: false },
				],
				description: 'Lottery closed. Winning number was selected from submitted tickets.',
			});
			return;
		}

		await replyWithEmbed(message, {
			title: 'Unknown Lottery Command',
			description: 'Use `' + commandPrefix + 'lottery help`.',
			color: 15158332,
		});
	};
}

module.exports = {
	createLotteryCommandHandler,
};