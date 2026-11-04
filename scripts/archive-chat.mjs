// Offline maintenance: archive chat only; never touch identities or Steam credentials.
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createClient } from '@libsql/client';

async function persistArchive(directory, document) {
	await fs.mkdir(directory, { recursive: true, mode: 0o700 });
	const info = await fs.lstat(directory);
	if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe archive directory');
	await fs.chmod(directory, 0o700);
	const name = `chat-${document.createdAt.slice(0, 7)}-${randomUUID()}.json.gz`;
	const partial = join(directory, name + '.partial');
	const payload = Buffer.from(JSON.stringify(document));
	const file = await fs.open(partial, 'wx', 0o600);
	try {
		await file.writeFile(gzipSync(payload));
		await file.sync();
	} finally {
		await file.close();
	}
	const verified = gunzipSync(await fs.readFile(partial), { maxOutputLength: payload.length });
	if (!payload.equals(verified)) throw new Error('Archive verification failed');
	await fs.rename(partial, join(directory, name));
	// Make the directory entry durable BEFORE committing removal from SQLite.
	if (process.platform !== 'win32') {
		const directoryHandle = await fs.open(directory, 'r');
		try {
			await directoryHandle.sync();
		} finally {
			await directoryHandle.close();
		}
	}
	return name;
}

export async function archiveChat({
	client,
	archiveDirectory,
	apply = false,
	now = Date.now(),
	keepDays = 30,
	keepMessages = 1000,
	batchSize = 500
}) {
	if (
		![keepDays, keepMessages, batchSize].every((n) => Number.isSafeInteger(n) && n > 0) ||
		batchSize > 500 ||
		!Number.isFinite(now)
	)
		throw new Error('Invalid archive policy');
	const cutoff = Math.floor(now / 1000) - keepDays * 86400;
	const result = { eligible: 0, archived: 0, files: [] };
	const accounts = await client.execute('SELECT id FROM steam_account ORDER BY id');
	for (const account of accounts.rows) {
		for (;;) {
			// Use one exclusively owned local connection; no background app shares this client.
			if (apply) await client.execute('BEGIN IMMEDIATE');
			let transactionOpen = apply;
			const connection = client;
			try {
				const boundary = (
					await connection.execute({
						sql: 'SELECT timestamp, id FROM steam_chat_message WHERE account_id = ? ORDER BY timestamp DESC, id DESC LIMIT 1 OFFSET ?',
						args: [account.id, keepMessages - 1]
					})
				).rows[0];
				if (!boundary) break;
				const predicate = 'account_id = ? AND timestamp < ? AND (timestamp, id) < (?, ?)';
				const args = [account.id, cutoff, boundary.timestamp, boundary.id];
				if (!apply) {
					const count = await connection.execute({
						sql: `SELECT count(*) AS count FROM steam_chat_message WHERE ${predicate}`,
						args
					});
					result.eligible += Number(count.rows[0].count);
					break;
				}
				const messages = (
					await connection.execute({
						sql: `SELECT * FROM steam_chat_message WHERE ${predicate} ORDER BY timestamp, id LIMIT ?`,
						args: [...args, batchSize]
					})
				).rows;
				if (!messages.length) break;
				const identity = (
					await connection.execute({
						sql: 'SELECT id, account_name, user_id FROM steam_account WHERE id = ?',
						args: [account.id]
					})
				).rows[0];
				const name = await persistArchive(archiveDirectory, {
					format: 'hoursbooster-chat-v1',
					createdAt: new Date(now).toISOString(),
					account: identity,
					messages
				});
				const removed = await connection.execute({
					sql: `DELETE FROM steam_chat_message WHERE id IN (${messages.map(() => '?').join(',')})`,
					args: messages.map((message) => message.id)
				});
				if (removed.rowsAffected !== messages.length) throw new Error('Archive row count changed');
				await client.execute('COMMIT');
				transactionOpen = false;
				result.eligible += messages.length;
				result.archived += messages.length;
				result.files.push(name);
			} finally {
				// Rolls back on archive write/read/verify/rename/fsync or SQL failure.
				if (transactionOpen) {
					try {
						await client.execute('ROLLBACK');
					} catch {
						/* SQLite may already have rolled back. */
					}
				}
			}
		}
	}
	return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	let client;
	try {
		if (process.argv.slice(2).some((arg) => arg !== '--apply')) throw new Error('Unknown argument');
		const url = process.env.DATABASE_URL || 'file:sqlite.db';
		if (
			!url.startsWith('file:') ||
			url.includes('?') ||
			url.includes('#') ||
			url === 'file::memory:'
		) {
			throw new Error('A local database is required');
		}
		process.umask(0o077);
		const database = resolve(url.slice(5));
		await fs.access(database); // Refuse to silently create a new, empty database.
		client = createClient({ url });
		const result = await archiveChat({
			client,
			archiveDirectory: join(dirname(database), 'chat-archives'),
			apply: process.argv.includes('--apply')
		});
		console.log(JSON.stringify(result));
	} catch {
		console.error(
			'Chat archive stopped. Check the local database, free disk space and permissions. No unverified batch is removed.'
		);
		process.exitCode = 1;
	} finally {
		client?.close();
	}
}
