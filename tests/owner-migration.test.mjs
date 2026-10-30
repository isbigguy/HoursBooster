import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

test('old database upgrades preserve mixed-case rows, credentials and chat with owner-scoped uniqueness', async () => {
	const client = createClient({ url: 'file::memory:' });
	const db = drizzle(client);
	try {
		await client.executeMultiple(
			readFileSync(new URL('../drizzle/0000_known_supernaut.sql', import.meta.url), 'utf8')
		);
		const first = readMigrationFiles({ migrationsFolder })[0];
		await client.execute(
			'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)'
		);
		await client.execute({
			sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
			args: [first.hash, first.folderMillis]
		});
		await client.executeMultiple(`
			INSERT INTO user (id, name, email) VALUES ('alice', 'Alice', 'alice@example.invalid'), ('bob', 'Bob', 'bob@example.invalid');
			INSERT INTO steam_account (id, account_name, user_id, refresh_token, iv, auth_tag, shared_secret, created_at, updated_at)
			VALUES ('upper', 'LegacyName', 'alice', 'synthetic-cipher', 'synthetic-iv', 'synthetic-tag', 'synthetic-seed-envelope', 1, 2),
			       ('lower', 'legacyname', 'alice', NULL, NULL, NULL, NULL, 3, 4),
			       ('local', 'LocalName', NULL, NULL, NULL, NULL, NULL, 5, 6);
			INSERT INTO steam_chat_message (account_id, steam_id_other, content) VALUES ('upper', '76561198000000001', 'synthetic-chat');
		`);
		const before = (await client.execute('SELECT * FROM steam_account ORDER BY id')).rows;
		const chat = (await client.execute('SELECT * FROM steam_chat_message')).rows;
		await migrate(db, { migrationsFolder });
		await migrate(db, { migrationsFolder });
		assert.deepEqual(
			(await client.execute('SELECT * FROM steam_account ORDER BY id')).rows,
			before
		);
		assert.deepEqual((await client.execute('SELECT * FROM steam_chat_message')).rows, chat);
		const indexes = (await client.execute("PRAGMA index_list('steam_account')")).rows.map(
			(row) => row.name
		);
		assert.equal(indexes.includes('steam_account_account_name_unique'), false);
		assert.ok(indexes.includes('steam_account_owner_name_unique'));
		assert.ok(indexes.includes('steam_account_local_name_unique'));
		const add = (id, name, owner) =>
			client.execute({
				sql: 'INSERT INTO steam_account (id, account_name, user_id, created_at, updated_at) VALUES (?, ?, ?, 7, 8)',
				args: [id, name, owner]
			});
		await add('bob-shared', 'LegacyName', 'bob');
		await add('local-shared', 'LegacyName', null);
		await add('owned-local', 'LocalName', 'bob');
		await assert.rejects(add('owned-duplicate', 'LegacyName', 'alice'), /UNIQUE/);
		await assert.rejects(add('local-duplicate', 'LocalName', null), /UNIQUE/);
		await assert.rejects(add('local-shared-duplicate', 'LegacyName', null), /UNIQUE/);
	} finally {
		client.close();
	}
});
