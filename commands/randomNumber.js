'use strict';

const { Permissions } = require('discord.js');

function createRandomNumberCommandHandler(options) {
	const commandPrefix = options.commandPrefix;
	const adminUserIds = options.adminUserIds;
	const defaultEmbedColor = 15859730;

	const commandName = commandPrefix + 'randomnumber';

	function isAdmin(message) {
		if (adminUserIds.has(message.author.id)) {
			return true;
		}

		if (message.member && message.member.permissions && message.member.permissions.has(Permissions.FLAGS.ADMINISTRATOR)) {
			return true;
		}

		return false;
	}

	async function handle(message) {
		const content = (message.content || '').trim();

		if (!content.toLowerCase().startsWith(commandName)) {
			return;
		}

		if (!isAdmin(message)) {
			await message.reply({
				embeds: [{
					title: '🎲 Random Number',
					color: 0xe74c3c,
					description: '❌ You need Administrator permissions to use this command.',
				}],
			});
			return;
		}

		const args = content.slice(commandName.length).trim().split(/\s+/).filter(Boolean);

		if (args.length < 2) {
			await message.reply({
				embeds: [{
					title: '🎲 Random Number',
					color: defaultEmbedColor,
					description: `**Usage:** \`${commandPrefix}randomnumber <min> <max>\`\n\nRolls a random whole number between **min** and **max** (inclusive).`,
				}],
			});
			return;
		}

		const min = parseInt(args[0], 10);
		const max = parseInt(args[1], 10);

		if (!Number.isFinite(min) || !Number.isFinite(max)) {
			await message.reply({
				embeds: [{
					title: '🎲 Random Number',
					color: 0xe74c3c,
					description: '❌ Both **min** and **max** must be valid whole numbers.',
				}],
			});
			return;
		}

		if (min >= max) {
			await message.reply({
				embeds: [{
					title: '🎲 Random Number',
					color: 0xe74c3c,
					description: '❌ **min** must be less than **max**.',
				}],
			});
			return;
		}

		const result = Math.floor(Math.random() * (max - min + 1)) + min;

		await message.reply({
			embeds: [{
				title: '🎲 Random Number',
				color: defaultEmbedColor,
				description: `Rolling between **${min}** and **${max}**...\n\n# ${result}`,
				footer: { text: 'Rolled by ' + (message.member?.displayName || message.author.username) },
				timestamp: new Date().toISOString(),
			}],
		});
	}

	return handle;
}

module.exports = { createRandomNumberCommandHandler };
