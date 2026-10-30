// Migrate the runtime database, never a database baked into an image.
await import('./migrate.mjs');
const { prepareServer } = await import('../.deno-deploy/handler.ts');
const deploy = JSON.parse(
	await Deno.readTextFile(new URL('../.deno-deploy/deploy.json', import.meta.url))
);
const svelte = JSON.parse(
	await Deno.readTextFile(new URL('../.deno-deploy/svelte.json', import.meta.url))
);
const handler = prepareServer(svelte, deploy, Deno.cwd());
Deno.serve(
	{ hostname: Deno.env.get('HOST') || '127.0.0.1', port: Number(Deno.env.get('PORT') || 8000) },
	handler
);
