import { auth, isAuthEnabled } from '$lib/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import { ready } from '$lib/server/setup';
import type { Handle } from '@sveltejs/kit';

import { createMockSession, createMockUser } from '$lib/server/mock';

export const handle: Handle = async ({ event, resolve }) => {
	await ready;
	const session = await auth.api.getSession({
		headers: event.request.headers
	});

	if (isAuthEnabled()) {
		if (session) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		}
	} else {
		event.locals.user = createMockUser() as any;
		event.locals.session = createMockSession() as any;
	}

	const response = await svelteKitHandler({ event, resolve, auth, building });
	response.headers.set('Cache-Control', 'private, no-store');
	response.headers.set('Referrer-Policy', 'no-referrer');
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	return response;
};
