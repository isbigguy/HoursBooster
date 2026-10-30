import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { building } from '$app/environment';
import { db } from './database';
import { config, isOidcEnabled as isOidcConfigured } from '$lib/server/config';

const oidcConfig = isOidcConfigured()
	? [
			{
				providerId: config.oidc.providerId!,
				clientId: config.oidc.clientId!,
				clientSecret: config.oidc.clientSecret!,
				discoveryUrl: config.oidc.discoveryUrl!,
				scopes: ['openid', 'profile', 'email']
			}
		]
	: [];

export const isOidcEnabled = isOidcConfigured;
export const getOidcProviderName = () => config.oidc.providerName || config.oidc.providerId || null;
export const getOidcProviderId = () => config.oidc.providerId || null;

export const isAuthEnabled = () => isOidcEnabled();

process.env.BETTER_AUTH_TELEMETRY = '0';

export const auth = betterAuth({
	telemetry: { enabled: false },
	database: drizzleAdapter(db, {
		provider: 'sqlite'
	}),
	secret: building ? 'build-only-placeholder-not-a-runtime-secret' : config.auth.secret,
	baseURL: building ? 'http://localhost:8000' : config.auth.url,
	plugins: [genericOAuth({ config: oidcConfig }), sveltekitCookies(getRequestEvent)]
});
