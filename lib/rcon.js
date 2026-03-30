'use strict';

const net = require('net');

const SERVERDATA_RESPONSE_VALUE = 0;
const SERVERDATA_EXECCOMMAND = 2;
const SERVERDATA_AUTH = 3;

/**
 * Build a Source RCON packet.
 * Format: [4-byte size LE][4-byte id LE][4-byte type LE][body\0][pad\0]
 */
function buildPacket(id, type, body) {
	const bodyBuf = Buffer.from(body, 'utf8');
	const size = 4 + 4 + bodyBuf.length + 1 + 1; // id + type + body + \0 + \0
	const buf = Buffer.alloc(4 + size);
	buf.writeInt32LE(size, 0);
	buf.writeInt32LE(id, 4);
	buf.writeInt32LE(type, 8);
	bodyBuf.copy(buf, 12);
	buf[12 + bodyBuf.length] = 0;
	buf[12 + bodyBuf.length + 1] = 0;
	return buf;
}

/**
 * Parse one RCON packet from a buffer.
 * Returns { id, type, body, totalLength } or null if buffer is incomplete.
 */
function parsePacket(buf) {
	if (buf.length < 4) return null;
	const size = buf.readInt32LE(0);
	if (buf.length < 4 + size) return null;
	const id = buf.readInt32LE(4);
	const type = buf.readInt32LE(8);
	const body = buf.slice(12, 4 + size - 2).toString('utf8');
	return { id, type, body, totalLength: 4 + size };
}

/**
 * Execute an RCON command against a single server.
 * Returns the response string.
 */
function rconExecute(host, port, password, command, timeoutMs = 10000) {
	return new Promise((resolve, reject) => {
		const socket = new net.Socket();
		let buffer = Buffer.alloc(0);
		let authenticated = false;
		let timer = null;

		function cleanup() {
			if (timer) clearTimeout(timer);
			socket.removeAllListeners();
			socket.destroy();
		}

		timer = setTimeout(() => {
			cleanup();
			reject(new Error('RCON timeout (' + host + ':' + port + ')'));
		}, timeoutMs);

		socket.connect(port, host, () => {
			socket.write(buildPacket(1, SERVERDATA_AUTH, password));
		});

		socket.on('data', (chunk) => {
			buffer = Buffer.concat([buffer, chunk]);

			let packet;
			while ((packet = parsePacket(buffer)) !== null) {
				buffer = buffer.slice(packet.totalLength);

				if (!authenticated) {
					// Auth response: id === 1 means success, id === -1 means failure
					if (packet.id === -1) {
						cleanup();
						reject(new Error('RCON auth failed (' + host + ':' + port + ')'));
						return;
					}
					if (packet.id === 1 && packet.type === 2) {
						authenticated = true;
						socket.write(buildPacket(2, SERVERDATA_EXECCOMMAND, command));
					}
				} else if (packet.id === 2 && packet.type === SERVERDATA_RESPONSE_VALUE) {
					cleanup();
					resolve(packet.body);
					return;
				}
			}
		});

		socket.on('error', (err) => {
			cleanup();
			reject(new Error('RCON connection error (' + host + ':' + port + '): ' + err.message));
		});

		socket.on('close', () => {
			cleanup();
			reject(new Error('RCON connection closed (' + host + ':' + port + ')'));
		});
	});
}

/**
 * Execute the same RCON command on multiple servers.
 * Returns an array of { serverId, result?, error? } objects.
 */
async function rconBroadcast(servers, command, timeoutMs) {
	const results = await Promise.allSettled(
		servers.map((s) =>
			rconExecute(s.rcon.host, s.rcon.port, s.rcon.password, command, timeoutMs)
				.then((result) => ({ serverId: s.id, result }))
		)
	);
	return results.map((r, i) =>
		r.status === 'fulfilled'
			? r.value
			: { serverId: servers[i].id, error: r.reason.message }
	);
}

module.exports = { rconExecute, rconBroadcast };
