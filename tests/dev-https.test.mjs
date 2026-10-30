import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer as createNetServer } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createTlsFixture } from './helpers/tls-fixture.mjs';
import { readTlsOptions } from '../scripts/https.mjs';

test('development HTTPS never serves public PEM or configured extensionless private keys', async () => {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const tls = await createTlsFixture();
	const sourceRoot = join(root, 'src');
	const keyDirectory = await mkdtemp(join(sourceRoot, 'tls-private-'));
	const keyFile = join(keyDirectory, 'private-material');
	const publicName = `tls-review-${randomUUID()}.pem`;
	const publicFile = join(root, 'static', publicName);
	const previous = { ...process.env };
	let vite;
	try {
		await writeFile(keyFile, tls.key);
		await writeFile(publicFile, tls.key);
		await assert.rejects(
			readTlsOptions({ TLS_CERT_FILE: tls.certFile, TLS_KEY_FILE: publicFile }),
			/public asset directories/
		);
		const reservation = createNetServer();
		await new Promise((done) => reservation.listen(0, '127.0.0.1', done));
		const port = reservation.address().port;
		await new Promise((done) => reservation.close(done));
		Object.assign(process.env, {
			TLS_CERT_FILE: tls.certFile,
			TLS_KEY_FILE: keyFile,
			BETTER_AUTH_URL: `https://localhost:${port}`,
			ORIGIN: `https://localhost:${port}`,
			BETTER_AUTH_SECRET: 'synthetic-dev-test-only-secret-0123456789abcdefgh',
			ALLOW_ANONYMOUS: 'true',
			DATABASE_URL: 'file::memory:'
		});
		const { createServer } = await import('vite');
		vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true } });
		await vite.listen();
		const get = (path) =>
			new Promise((done, fail) => {
				const request = httpsRequest(
					{
						hostname: '127.0.0.1',
						servername: 'localhost',
						port,
						path,
						ca: tls.cert,
						headers: { Host: `localhost:${port}` }
					},
					(response) => {
						const parts = [];
						response.on('data', (part) => parts.push(part));
						response.on('error', fail);
						response.on('end', () =>
							done({ status: response.statusCode, body: Buffer.concat(parts).toString() })
						);
					}
				);
				request.on('error', fail);
				request.setTimeout(5000, () => request.destroy(new Error('HTTPS probe timed out')));
				request.end();
			});
		for (const path of [
			`/${publicName}`,
			`/${publicName.replace('.pem', '%2epem')}`,
			`/@fs/${keyFile.replaceAll('\\', '/')}`,
			`/${relative(root, keyFile).replaceAll('\\', '/')}?raw`
		]) {
			const response = await get(path);
			assert.notEqual(response.status, 200, path);
			assert.equal(response.body.includes(tls.key.toString()), false);
			assert.equal(response.body.includes('-----BEGIN PRIVATE KEY-----'), false);
		}
	} finally {
		await vite?.close();
		for (const name of Object.keys(process.env)) if (!(name in previous)) delete process.env[name];
		Object.assign(process.env, previous);
		await rm(publicFile, { force: true });
		const child = relative(sourceRoot, keyDirectory);
		assert.ok(child && !child.startsWith('..') && !isAbsolute(child));
		await rm(keyDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		await tls.cleanup();
	}
});
