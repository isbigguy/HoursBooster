import { env } from '$env/dynamic/private';

export const config = {
	auth: {
		secret: env.BETTER_AUTH_SECRET,
		url: env.BETTER_AUTH_URL
	},
	oidc: {
		providerName: env.OIDC_PROVIDER_NAME,
		providerId: env.OIDC_PROVIDER_ID,
		clientId: env.OIDC_CLIENT_ID,
		clientSecret: env.OIDC_CLIENT_SECRET,
		discoveryUrl: env.OIDC_DISCOVERY_URL
	},
	database: {
		url: env.DATABASE_URL || 'file:sqlite.db'
	},
	general: {
		localAccountName: env.LOCAL_ACCOUNT_NAME || 'Anonymous',
		allowAnonymous: env.ALLOW_ANONYMOUS === 'true'
	}
};

export const isOidcEnabled = () => {
	const { providerId, clientId, clientSecret, discoveryUrl } = config.oidc;
	return !!(providerId && clientId && clientSecret && discoveryUrl);
};

export function validateConfig() {
	if (!config.auth.secret || config.auth.secret.length < 32) {
		throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters');
	}
	if (Object.values(config.oidc).some(Boolean) && !isOidcEnabled()) {
		throw new Error('Incomplete OIDC configuration');
	}
	if (!isOidcEnabled() && !config.general.allowAnonymous) {
		throw new Error('Configure OIDC or explicitly enable ALLOW_ANONYMOUS for local use');
	}
	for (const value of [config.auth.url, config.oidc.discoveryUrl].filter(Boolean)) {
		const url = new URL(value!);
		if (
			url.protocol !== 'https:' &&
			!(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
		) {
			throw new Error('Authentication URLs require HTTPS outside localhost');
		}
	}
}
