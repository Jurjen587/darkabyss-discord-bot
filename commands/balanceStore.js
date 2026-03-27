const path = require('path');
const fs = require('fs');

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

function writeBalances(data) {
	ensureDataFiles();
	fs.writeFileSync(balancesPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

const balances = readBalances();

function normalizeAmount(value) {
	return Math.round(value * 100) / 100;
}

function getBalance(userId, startingAmount) {
	const existing = Number(balances[userId]);
	if (Number.isFinite(existing) && existing >= 0) {
		return normalizeAmount(existing);
	}

	const initial = normalizeAmount(startingAmount != null ? Number(startingAmount) : 0);
	balances[userId] = initial;
	writeBalances(balances);
	return initial;
}

function setBalance(userId, amount) {
	balances[userId] = normalizeAmount(Math.max(0, amount));
	writeBalances(balances);
	return balances[userId];
}

module.exports = { balances, normalizeAmount, getBalance, setBalance };
