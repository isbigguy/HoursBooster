import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const client = createClient({ url: process.env.DATABASE_URL || 'file:sqlite.db' });
try {
	await migrate(drizzle(client), {
		migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url))
	});
} finally {
	client.close();
}
