import type { AccountInfo, Connection, PluginContext } from './api.ts';
import type * as OAuth2 from './oauth2.d.ts';
import type * as ApiKey from './api-key.d.ts';

const CLOUD = 'https://api.bitbucket.org/2.0';
const SPEC = 'https://dac-static.atlassian.com/cloud/bitbucket/swagger.v3.json';

/** Keep Data Center context paths, but reject URLs containing credentials or query data. */
function serverUrl(input: unknown): string {
  const text = String(input ?? '').trim();
  if (!text) throw new Error('Enter your Bitbucket server URL');
  if (/^[a-z][a-z\d+.-]*:/i.test(text) && !/^https?:\/\//i.test(text))
    throw new Error('Use an HTTP(S) Bitbucket server URL');
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`); }
  catch { throw new Error('Enter a valid Bitbucket server URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Use an HTTP(S) server URL without credentials, a query or a fragment');
  return url.href.replace(/\/+$/, '');
}

async function getJson(url: string, authorization: string) {
  const res = await fetch(url, {
    headers: { authorization, accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  }).catch(() => { throw new Error(`Could not reach Bitbucket at ${new URL(url).host}`); });
  if (res.status === 401 || res.status === 403) throw new Error('Bitbucket did not accept these credentials or their permissions');
  if (!res.ok) throw new Error(`Bitbucket responded ${res.status}`);
  try { return await res.json(); }
  catch { throw new Error('Bitbucket did not return JSON; check the server URL'); }
}

async function cloudAccount(authorization: string): Promise<AccountInfo> {
  const user = await getJson(`${CLOUD}/user`, authorization);
  if (!user?.uuid) throw new Error('Bitbucket did not return an account identity');
  return { id: user.uuid, label: user.display_name ?? user.nickname ?? user.uuid, avatarUrl: user.links?.avatar?.href };
}

export default function setup(ctx: PluginContext) {
  const oauth = ctx.require<typeof OAuth2>('oauth2');
  const apiKey = ctx.require<typeof ApiKey>('api-key');
  const configured = !!(ctx.settings.clientId && ctx.settings.clientSecret);
  const isServer = (conn: Connection) => conn.methodId === 'pat';
  return {
    services: [{
      id: 'bitbucket',
      name: 'Bitbucket',
      description: 'Repositories, pull requests and Cloud pipelines',
      icon: 'icon.svg',
      docsUrl: 'https://developer.atlassian.com/cloud/bitbucket/rest/',
      baseUrl: (conn: Connection) => isServer(conn) ? serverUrl(conn.config.site) : CLOUD,
      allowedHosts: (conn: Connection) => isServer(conn) ? [new URL(serverUrl(conn.config.site)).host] : ['api.bitbucket.org'],
      openapi: (conn: Connection) => isServer(conn) ? undefined : SPEC,
      authMethods: [
        oauth.authorizationCode({
          id: 'oauth',
          name: 'Sign in with Bitbucket',
          description: 'Bitbucket Cloud',
          unavailable: configured ? undefined : 'An administrator needs to set up a Bitbucket OAuth consumer first',
          authorizeUrl: 'https://bitbucket.org/site/oauth2/authorize',
          tokenUrl: 'https://bitbucket.org/site/oauth2/access_token',
          clientId: () => ctx.settings.clientId,
          clientSecret: () => ctx.settings.clientSecret,
          tokenAuth: 'basic',
          pkce: false,
          // Bitbucket grants the permissions configured on the consumer; request scopes cannot narrow them.
          identify: creds => cloudAccount(`Bearer ${creds.accessToken}`),
        }),
        apiKey.basicAuth({
          id: 'api-token',
          name: 'API token',
          description: 'Bitbucket Cloud, with your Atlassian email address',
          usernameLabel: 'Email',
          secretLabel: 'API token',
          secretDescription: 'Create a scoped Bitbucket token at id.atlassian.com/manage-profile/security/api-tokens. Include read:user:bitbucket for account validation.',
          identify: creds => cloudAccount(`Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`),
        }),
        apiKey.bearerToken({
          id: 'pat',
          name: 'Personal access token',
          description: 'Bitbucket Data Center and Server',
          secretDescription: 'Create a personal HTTP access token in Bitbucket account settings, with repository read permission.',
          fields: [
            { key: 'site', label: 'Server URL', required: true, placeholder: 'https://bitbucket.example.com' },
            { key: 'label', label: 'Account label', description: 'For example your work account; Data Center does not expose a universal current-user endpoint.' },
          ],
          async identify(creds, config) {
            const site = serverUrl(config.site);
            // Unlike public repository/user endpoints, the inbox requires an authenticated user.
            const inbox = await getJson(`${site}/rest/api/1.0/inbox/pull-requests?limit=1`, `Bearer ${creds.token}`);
            if (!Array.isArray(inbox?.values)) throw new Error('Bitbucket did not return an authenticated inbox');
            return { label: `${config.label || 'Bitbucket account'} (${new URL(site).host})` };
          },
        }),
      ],
    }],
  };
}
