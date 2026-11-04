import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createClient } from '@libsql/client';
import { archiveChat } from '../scripts/archive-chat.mjs';

test('chat archival keeps recent messages and preserves every field, owner and credential on failure', async (t) => {
	const directory = await fs.mkdtemp(join(tmpdir(), 'chat-archive-'));
	const client = createClient({ url: pathToFileURL(join(directory, 'chat.db')).href });
	const archiveDirectory = join(directory, 'archives');
	const now = Date.UTC(2026, 10, 5);
	const old = Math.floor(now / 1000) - 60 * 86400;
	try {
		await client.executeMultiple(`
			CREATE TABLE steam_account (id TEXT PRIMARY KEY, account_name TEXT, user_id TEXT, refresh_token TEXT);
			CREATE TABLE steam_chat_message (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT,
			steam_id_other TEXT, sender_name TEXT, content TEXT, direction TEXT, timestamp INTEGER);
			CREATE INDEX steam_chat_account_timestamp_idx ON steam_chat_message(account_id, timestamp);
			INSERT INTO steam_account VALUES ('alice','SameName','owner-a','synthetic-secret'),
			('bob','SameName','owner-b','other-secret'),('../local','Local',NULL,NULL);
		`);
		for (const [account, count] of [
			['alice', 10],
			['bob', 2],
			['../local', 5]
		]) {
			for (let i = 0; i < count; i++) {
				await client.execute({
					sql: 'INSERT INTO steam_chat_message(account_id,steam_id_other,sender_name,content,direction,timestamp) VALUES(?,?,?,?,?,?)',
					args: [
						account,
						'76561198000000001',
						null,
						`ВАЖНО: не терять\n<script>text</script> 💬 ${i}`,
						i % 2 ? 'outgoing' : 'incoming',
						account === 'alice' && i >= 8 ? Math.floor(now / 1000) : old
					]
				});
			}
		}
		const rows = async () =>
			(await client.execute('SELECT * FROM steam_chat_message ORDER BY id')).rows;
		const before = await rows();
		const accounts = (await client.execute('SELECT * FROM steam_account ORDER BY id')).rows;
		const options = { client, archiveDirectory, now, keepMessages: 3, batchSize: 2 };
		const preview = await archiveChat(options);
		assert.equal(preview.eligible, 9);
		assert.equal(preview.archived, 0);
		assert.deepEqual(await rows(), before);
		await assert.rejects(fs.stat(archiveDirectory), { code: 'ENOENT' });

		await t.test('disk/write failure leaves originals intact', async () => {
			const blocked = join(directory, 'not-a-directory');
			await fs.writeFile(blocked, 'synthetic');
			await assert.rejects(archiveChat({ ...options, archiveDirectory: blocked, apply: true }));
			assert.deepEqual(await rows(), before);
		});
		await t.test('corrupt reread refuses to remove any original', async () => {
			const originalRead = fs.readFile;
			const stub = mock.method(fs, 'readFile', async (path, ...args) =>
				String(path).endsWith('.partial') ? Buffer.from('corrupt') : originalRead(path, ...args)
			);
			try {
				await assert.rejects(archiveChat({ ...options, apply: true }));
				assert.deepEqual(await rows(), before);
			} finally {
				stub.mock.restore();
			}
		});
		await t.test(
			'SQL failure after a verified archive rolls back; retry can only duplicate archives',
			async () => {
				await client.executeMultiple(
					"CREATE TRIGGER refuse_delete BEFORE DELETE ON steam_chat_message BEGIN SELECT RAISE(ABORT,'synthetic'); END;"
				);
				await assert.rejects(archiveChat({ ...options, apply: true }));
				assert.deepEqual(await rows(), before);
				await client.execute('DROP TRIGGER refuse_delete');
			}
		);
		const moved = await archiveChat({ ...options, apply: true });
		assert.equal(moved.archived, 9);
		const remaining = await rows();
		for (const [account, expected] of [
			['alice', 3],
			['bob', 2],
			['../local', 3]
		]) {
			assert.equal(remaining.filter((row) => row.account_id === account).length, expected);
		}
		assert.equal(remaining.filter((row) => row.timestamp === now / 1000).length, 2);
		const combined = new Map(remaining.map((row) => [row.id, row]));
		for (const name of (await fs.readdir(archiveDirectory)).filter((name) =>
			name.endsWith('.json.gz')
		)) {
			assert.match(name, /^chat-2026-11-[a-f0-9-]+\.json\.gz$/);
			const path = join(archiveDirectory, name);
			const doc = JSON.parse(gunzipSync(await fs.readFile(path)));
			assert.equal(doc.format, 'hoursbooster-chat-v1');
			const owner = accounts.find((account) => account.id === doc.account.id);
			assert.equal(doc.account.user_id, owner.user_id);
			assert.equal(doc.account.account_name, owner.account_name);
			assert.equal(Object.hasOwn(doc.account, 'refresh_token'), false);
			for (const row of doc.messages) {
				assert.equal(row.account_id, doc.account.id);
				assert.deepEqual(row, { ...before.find((original) => original.id === row.id) });
				combined.set(row.id, row);
			}
			if (process.platform !== 'win32') assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
		}
		assert.deepEqual(
			[...combined.values()].sort((a, b) => a.id - b.id),
			before.map((row) => ({ ...row }))
		);
		assert.deepEqual(
			(await client.execute('SELECT * FROM steam_account ORDER BY id')).rows,
			accounts
		);
		assert.equal((await archiveChat({ ...options, apply: true })).archived, 0);
		await assert.rejects(archiveChat({ ...options, keepMessages: 0 }));
	} finally {
		client.close();
		// Match other SQLite tests: the native driver retains handles until exit on Windows.
		if (process.platform !== 'win32') await fs.rm(directory, { recursive: true, force: true });
	}
});
