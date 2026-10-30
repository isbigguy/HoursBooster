import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parse } from 'devalue';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await readFile(join(root, '.deno-deploy', 'deploy.json'));
const scratch = await mkdtemp(join(tmpdir(), 'hoursbooster-runtime-'));
const portable = (value) => value.replaceAll('\\', '/');
const canary = `private-runtime-canary-${randomUUID()}`;
await writeFile(join(scratch, 'private-canary.txt'), canary);
await mkdir(join(scratch, 'cache'));
const child = spawn(
	process.env.DENO_BINARY || 'deno',
	[
		'run',
		'--cached-only',
		'--no-prompt',
		'--allow-env',
		'--allow-net',
		'--allow-sys',
		`--allow-read=${portable(root)},${portable(scratch)}`,
		`--allow-write=${portable(scratch)}`,
		`--allow-ffi=${portable(join(root, 'node_modules'))}`,
		'scripts/start.ts'
	],
	{
		cwd: root,
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			HOST: '127.0.0.1',
			PORT: '0',
			DATABASE_URL: `file:${portable(join(scratch, 'test.db'))}`,
			DENO_DIR: join(scratch, 'cache'),
			BETTER_AUTH_SECRET: `synthetic-runtime-test-only-${randomUUID()}`,
			BETTER_AUTH_URL: 'http://127.0.0.1',
			ORIGIN: 'http://127.0.0.1',
			BETTER_AUTH_TELEMETRY: '0',
			ALLOW_ANONYMOUS: 'true',
			OIDC_PROVIDER_NAME: '',
			OIDC_PROVIDER_ID: '',
			OIDC_CLIENT_ID: '',
			OIDC_CLIENT_SECRET: '',
			OIDC_DISCOVERY_URL: ''
		}
	}
);
let output = '';
let launchError;
child.stdout.on('data', (data) => (output += data));
child.stderr.on('data', (data) => (output += data));
child.on('error', (failure) => (launchError = failure));
const closed = new Promise((done) => child.once('close', done));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

try {
	let base;
	for (let attempt = 0; attempt < 200; attempt++) {
		if (launchError) throw launchError;
		if (child.exitCode !== null) throw new Error(`Deno exited before readiness:\n${output}`);
		base = /Listening on (http:\/\/127\.0\.0\.1:\d+\/)/.exec(output)?.[1];
		if (base) break;
		await pause(100);
	}
	assert.ok(base, `No listening address from Deno:\n${output}`);
	const origin = new URL(base).origin;
	const get = (url) => fetch(url, { signal: AbortSignal.timeout(15_000) });
	const page = await get(base);
	assert.equal(page.status, 200);
	assert.match(page.headers.get('content-type'), /text\/html/);
	assert.match(page.headers.get('cache-control'), /no-store/);
	const html = await page.text();
	assert.match(html, /Welcome back/);
	assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com|steamdb\.info/);
	console.log('PASS: production page and private no-store response');

	const queue = [];
	const visited = new Set();
	function enqueue(candidate, parent) {
		const url = new URL(candidate, parent);
		if (url.origin !== origin || !url.pathname.startsWith('/_app/immutable/')) return;
		if (!/\.(?:js|css)$/.test(url.pathname)) return;
		if (!visited.has(url.href)) queue.push(url.href);
	}
	for (const match of html.matchAll(/(?:href|src)=["']([^"']+)["']|import\(\s*["']([^"']+)["']/g)) {
		enqueue(match[1] || match[2], base);
	}
	let cssCount = 0;
	let jsCount = 0;
	while (queue.length) {
		const url = queue.shift();
		if (visited.has(url)) continue;
		visited.add(url);
		assert.ok(visited.size < 500, 'Unexpectedly large static import graph');
		const asset = await get(url);
		assert.equal(asset.status, 200, `Missing asset: ${new URL(url).pathname}`);
		const body = await asset.text();
		assert.ok(body.length > 0, `Empty asset: ${url}`);
		if (new URL(url).pathname.endsWith('.css')) {
			assert.match(asset.headers.get('content-type'), /^text\/css\b/);
			cssCount++;
		} else {
			assert.match(asset.headers.get('content-type'), /^(?:text|application)\/javascript\b/);
			jsCount++;
			for (const match of body.matchAll(
				/(["'])(\.{0,2}\/[^"'\\\s]+?\.(?:js|css)(?:\?[^"'\\\s]*)?)\1/g
			)) {
				enqueue(match[2], url);
			}
		}
	}
	assert.ok(cssCount > 0, 'No linked stylesheets were checked');
	assert.ok(jsCount > 1, 'No client entry modules were checked');
	console.log(
		`PASS: ${cssCount} stylesheet(s) and ${jsCount} JavaScript module(s), including imports`
	);
	const favicon = await get(new URL('/favicon.svg', base));
	assert.equal(favicon.status, 200);
	assert.match(favicon.headers.get('content-type'), /^image\/svg\+xml\b/);
	assert.match(await favicon.text(), /<svg/);
	console.log('PASS: favicon content and MIME type');

	for (const pathname of [
		'/_app/immutable/not-present-runtime-test.js',
		'/_app/immutable/../../package.json',
		'/_app/immutable/%2e%2e%2fpackage.json',
		'/_app/immutable/..%5c..%5cpackage.json',
		'/_app/immutable/%252e%252e%252fpackage.json',
		'/scripts/start.ts',
		'/.env'
	]) {
		const response = await get(new URL(pathname, base));
		const body = await response.text();
		assert.notEqual(response.status, 200, `Expected rejection for ${pathname}`);
		assert.equal(body.includes(canary), false);
		assert.equal(body.includes('"packageManager"'), false);
		assert.equal(body.includes('BETTER_AUTH_SECRET='), false);
	}
	console.log('PASS: missing assets, traversal variants and private source paths are not served');

	if (process.env.LIVE_STEAM === '1') {
		async function action(name, fields = {}) {
			const response = await fetch(`${origin}/?/${name}`, {
				method: 'POST',
				headers: { Origin: origin, Accept: 'application/json', 'x-sveltekit-action': 'true' },
				body: new URLSearchParams(fields),
				signal: AbortSignal.timeout(45_000)
			});
			const result = await response.json();
			return {
				...result,
				http: response.status,
				data: result.data ? parse(result.data) : undefined
			};
		}
		const started = await action('startQrLogin');
		assert.equal(started.type, 'success', `QR start failed with status ${started.http}`);
		assert.equal(new URL(started.data.qrUrl).hostname, 's.team');
		try {
			const pending = await action('pollQrLogin', { sessionId: started.data.sessionId });
			assert.equal(pending.data.pending, true);
		} finally {
			const cancelled = await action('cancelQrLogin', { sessionId: started.data.sessionId });
			assert.equal(cancelled.data.success, true);
			const after = await action('pollQrLogin', { sessionId: started.data.sessionId });
			assert.equal(after.http, 404);
		}
		console.log('PASS: live Steam QR challenge, pending poll and cancellation; challenge omitted');
	}
} finally {
	// Only this test's child is stopped. No existing user service is queried or stopped.
	if (child.exitCode === null) child.kill();
	await closed;
	await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
