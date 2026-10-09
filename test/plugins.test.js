import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import oauthSetup from './fixtures/oauth2.ts';
import apiKeySetup from './fixtures/api-key.ts';

// Fixtures are the actual Switchboard auth helpers, rather than simplified auth mocks.
const dependencies = { oauth2: oauthSetup({}).exports, 'api-key': apiKeySetup({}).exports };
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'atlassian-plugins-test-'));
test.after(() => fs.rm(temporary, { recursive: true, force: true }));
async function load(id, settings = {}) {
  const dir = path.join(temporary, id);
  await fs.cp(new URL(`../plugins/${id}/`, import.meta.url), dir, { recursive: true });
  const setup = (await import(pathToFileURL(path.join(dir, 'index.ts')).href)).default;
  return setup({ settings, require: id => dependencies[id], dir }).services;
}
const atlassian = await load('atlassian');
const [bitbucket] = await load('bitbucket');
const method = (service, id) => service.authMethods.find(m => m.id === id);
const connection = (methodId, config = {}, credentials = {}) => ({ methodId, config, credentials });
async function fakeFetch(run, responses) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), ...options });
    assert.ok(responses.length, `Unexpected fetch: ${url}`);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
  };
  try { await run(requests); assert.equal(responses.length, 0); }
  finally { globalThis.fetch = original; }
}

test('copied plugins load independently; migration retains plugin/service/auth identities', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../plugins/atlassian/plugin.json', import.meta.url)));
  assert.equal(manifest.id, 'atlassian');
  assert.deepEqual(atlassian.map(s => s.id), ['jira', 'confluence']);
  for (const service of [...atlassian, bitbucket]) {
    assert.deepEqual(service.authMethods.map(m => m.id), ['oauth', 'api-token', 'pat']);
    assert.ok(method(service, 'oauth').unavailable);
  }
});

test('Jira and Confluence keep Cloud, OAuth and context-path Data Center routing', () => {
  for (const service of atlassian) {
    assert.equal(service.baseUrl(connection('api-token', { site: 'team' })), 'https://team.atlassian.net');
    const oauth = connection('oauth', { cloudId: 'site-id' });
    assert.equal(service.baseUrl(oauth), `https://api.atlassian.com/ex/${service.id}/site-id`);
    assert.deepEqual(service.allowedHosts(oauth), ['api.atlassian.com']);
    const dc = connection('pat', { site: 'https://internal.example/context/' });
    assert.equal(service.baseUrl(dc), 'https://internal.example/context');
    assert.equal(service.openapi(dc), undefined);
  }
});

test('existing Jira/Confluence API token credentials and account IDs are preserved', async () => {
  for (const service of atlassian) {
    await fakeFetch(async requests => {
      const result = await method(service, 'api-token').connect({ config: { site: 'team', username: 'user@example.com', password: 'secret' } });
      assert.equal(result.account.id, 'account-id@team.atlassian.net');
      assert.deepEqual(result.config, { site: 'team' });
      assert.deepEqual(result.credentials, { username: 'user@example.com', password: 'secret' });
      assert.equal(requests[0].url, `https://team.atlassian.net${service.id === 'jira' ? '/rest/api/3/myself' : '/wiki/rest/api/user/current'}`);
    }, [{ body: { accountId: 'account-id', emailAddress: 'user@example.com' } }]);
  }
});

test('Atlassian OAuth selects the requested site and keeps account/config format', async () => {
  const [jira] = await load('atlassian', { clientId: 'client', clientSecret: 'secret' });
  await fakeFetch(async requests => {
    const result = await method(jira, 'oauth').callback({ config: { site: 'wanted' }, params: { code: 'code' }, callbackUrl: 'https://switchboard.example/callback' });
    assert.equal(result.config.cloudId, 'wanted-id');
    assert.equal(result.config.site, 'https://wanted.atlassian.net');
    assert.equal(result.account.id, 'user-id@wanted-id');
    assert.equal(result.credentials.refreshToken, 'refresh');
    assert.equal(requests[1].url, 'https://api.atlassian.com/oauth/token/accessible-resources');
  }, [
    { body: { access_token: 'access', refresh_token: 'refresh' } },
    { body: [{ id: 'other', url: 'https://other.atlassian.net' }, { id: 'wanted-id', url: 'https://wanted.atlassian.net' }] },
    { body: { account_id: 'user-id', email: 'user@example.com' } },
  ]);
});

test('Bitbucket API tokens validate /user and keep secrets out of config', async () => {
  await fakeFetch(async requests => {
    const result = await method(bitbucket, 'api-token').connect({ config: { username: 'user@example.com', password: 'secret' } });
    assert.equal(result.account.id, '{uuid}');
    assert.deepEqual(result.config, {});
    assert.equal(requests[0].url, 'https://api.bitbucket.org/2.0/user');
    const authorization = `Basic ${Buffer.from('user@example.com:secret').toString('base64')}`;
    assert.equal(requests[0].headers.authorization, authorization);
    assert.equal(requests[0].redirect, 'error');
    const req = { headers: new Headers() };
    await method(bitbucket, 'api-token').authorize(req, connection('api-token', {}, result.credentials), {});
    assert.equal(req.headers.get('authorization'), authorization);
  }, [{ body: { uuid: '{uuid}', display_name: 'User', links: { avatar: { href: 'https://avatar.example/user' } } } }]);
});

test('Bitbucket OAuth uses its consumer endpoints, Basic auth and refresh-token rotation', async () => {
  const [service] = await load('bitbucket', { clientId: 'consumer', clientSecret: 'consumer-secret' });
  const oauth = method(service, 'oauth');
  assert.equal(oauth.unavailable, undefined);
  const args = { config: {}, callbackUrl: 'https://switchboard.example/callback', state: 'state' };
  const step = await oauth.connect(args);
  const redirect = new URL(step.redirect);
  assert.equal(redirect.origin, 'https://bitbucket.org');
  assert.equal(redirect.pathname, '/site/oauth2/authorize');
  assert.equal(redirect.searchParams.get('state'), 'state');
  assert.equal(redirect.searchParams.get('scope'), null);
  assert.equal(redirect.searchParams.get('code_challenge'), null);
  await fakeFetch(async requests => {
    const result = await oauth.callback({ ...args, pending: step.pending, params: { code: 'code' } });
    assert.equal(result.account.id, '{uuid}');
    assert.equal(requests[0].url, 'https://bitbucket.org/site/oauth2/access_token');
    assert.equal(requests[0].headers.authorization, `Basic ${Buffer.from('consumer:consumer-secret').toString('base64')}`);
    assert.equal(requests[0].body.get('grant_type'), 'authorization_code');
    const conn = connection('oauth', {}, { ...result.credentials, expiresAt: 0 });
    const req = { headers: new Headers() };
    const renewal = await oauth.authorize(req, conn, {});
    assert.equal(requests[2].body.get('grant_type'), 'refresh_token');
    assert.equal(requests[2].body.get('refresh_token'), 'refresh');
    assert.equal(renewal.credentials.refreshToken, 'rotated');
    assert.equal(req.headers.get('authorization'), 'Bearer renewed');
  }, [
    { body: { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 } },
    { body: { uuid: '{uuid}', display_name: 'User' } },
    { body: { access_token: 'renewed', refresh_token: 'rotated', expires_in: 3600 } },
  ]);
});

test('Bitbucket scopes its API hosts and Cloud spec to the selected deployment', () => {
  const cloud = connection('api-token');
  assert.equal(bitbucket.baseUrl(cloud), 'https://api.bitbucket.org/2.0');
  assert.deepEqual(bitbucket.allowedHosts(cloud), ['api.bitbucket.org']);
  assert.equal(bitbucket.openapi(cloud), 'https://dac-static.atlassian.com/cloud/bitbucket/swagger.v3.json');
  const dc = connection('pat', { site: 'https://internal.example:8443/bitbucket/' });
  assert.equal(bitbucket.baseUrl(dc), 'https://internal.example:8443/bitbucket');
  assert.deepEqual(bitbucket.allowedHosts(dc), ['internal.example:8443']);
  assert.equal(bitbucket.openapi(dc), undefined);
});

test('Bitbucket Data Center validates a protected inbox without inventing a user ID', async () => {
  await fakeFetch(async requests => {
    const result = await method(bitbucket, 'pat').connect({ config: { site: 'https://internal.example/bitbucket/', token: 'secret', label: 'Work' } });
    assert.equal(requests[0].url, 'https://internal.example/bitbucket/rest/api/1.0/inbox/pull-requests?limit=1');
    assert.equal(requests[0].headers.authorization, 'Bearer secret');
    assert.deepEqual(result.credentials, { token: 'secret' });
    assert.equal(result.config.token, undefined);
    assert.equal(result.account.id, undefined);
    assert.equal(result.account.label, 'Work (internal.example)');
    const req = { headers: new Headers() };
    await method(bitbucket, 'pat').authorize(req, connection('pat', result.config, result.credentials), {});
    assert.equal(req.headers.get('authorization'), 'Bearer secret');
  }, [{ body: { values: [], isLastPage: true } }]);
});

test('Bitbucket rejects credentials, missing identity, malformed inbox and redirects', async () => {
  for (const status of [401, 403, 404, 302, 429, 500]) {
    await fakeFetch(async () => {
      await assert.rejects(method(bitbucket, 'api-token').connect({ config: { username: 'user', password: 'secret' } }), /Bitbucket/);
    }, [{ status, body: { error: 'secret must not appear in errors' } }]);
  }
  await fakeFetch(async () => {
    await assert.rejects(method(bitbucket, 'api-token').connect({ config: { username: 'user', password: 'secret' } }), /account identity/);
  }, [{ body: {} }]);
  await fakeFetch(async () => {
    await assert.rejects(method(bitbucket, 'pat').connect({ config: { site: 'https://internal.example', token: 'secret' } }), /authenticated inbox/);
  }, [{ body: {} }]);
  await fakeFetch(async () => {
    await assert.rejects(method(bitbucket, 'api-token').connect({ config: {} }), { message: 'Could not reach Bitbucket at api.bitbucket.org' });
  }, [new Error('transport details with secret')]);
});

test('Bitbucket rejects malformed server URLs before sending a token', async () => {
  for (const site of ['', 'ftp://internal.example', 'file:///tmp/secret', 'https://user:secret@internal.example', 'https://internal.example?token=secret', 'https://internal.example#fragment']) {
    await fakeFetch(async () => {
      await assert.rejects(method(bitbucket, 'pat').connect({ config: { site, token: 'secret' } }), /server URL/);
    }, []);
  }
});
