import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const source = path.resolve(process.env.SWITCHBOARD_ROOT ?? '../switchboard');
const load = file => import(pathToFileURL(path.join(source, file)).href);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'atlassian-output-preview-'));
const dataDir = path.join(temporary, 'data');
const previewRoot = path.join(temporary, 'outputs');
const instance = 'atlassian-preview-fixture';
const originalFetch = globalThis.fetch;
const secret = 'synthetic-atlassian-fixture-token';
const username = 'demo@example.invalid';
const basic = 'Basic ' + Buffer.from(`${username}:${secret}`).toString('base64');
const bearer = 'Bearer ' + secret;
const url = 'https://api.bitbucket.org/2.0/user';
const profile = {
  type: 'user',
  uuid: '{private-uuid}',
  display_name: 'Private display name',
  links: { avatar: { href: 'https://avatar.example.invalid/private' }, token: secret },
  token: secret,
};
const expected = { type: 'user' };
const caller = { source: 'proxy', tokenId: null, tokenName: null, ip: null, userAgent: null };
let plugins, database;

try {
  Object.assign(process.env, {
    SWITCHBOARD_DATA_DIR: dataDir,
    SWITCHBOARD_WATCH_PLUGINS: 'false',
    SWITCHBOARD_ACTIVITY_PREVIEW_ROOT: previewRoot,
    SWITCHBOARD_ACTIVITY_PREVIEW_RESTORE_SAFE: '1',
    SWITCHBOARD_ACTIVITY_PREVIEW_INSTANCE: instance,
    SWITCHBOARD_ACTIVITY_PREVIEW_EPOCH: 'fixture-epoch',
  });
  await fs.cp(new URL('../plugins/', import.meta.url), path.join(dataDir, 'plugins'), { recursive: true });

  const db = await load('server/db.ts');
  db.initDb();
  database = db.db;
  const { initKey, encrypt } = await load('server/crypto.ts');
  initKey();
  const { config } = await load('server/config.ts');
  const { openPreviewStore } = await load('shared/activity-preview-store.ts');
  openPreviewStore(previewRoot, [dataDir], instance);
  config.previewStoreId = JSON.parse(await fs.readFile(path.join(previewRoot, 'store.json'), 'utf8')).storeId;
  const output = await load('server/activity-output.ts');
  output.initOutputStore();
  output.setOutputRetention(4);
  plugins = (await load('server/plugins/manager.ts')).plugins;
  await plugins.start();

  const { createUser, createToken } = await load('server/users.ts');
  const { execute } = await load('server/proxy.ts');
  const owner = createUser('atlassian-preview-owner', 'admin');
  const other = createUser('atlassian-preview-other', 'admin');

  function connect(service, auth, config = {}) {
    assert.ok(plugins.service(service)?.authMethods.some(method => method.id === auth));
    const id = `${service}-${auth}`;
    const now = Date.now();
    const credentials = {
      oauth: { accessToken: secret, expiresAt: now + 3600_000 },
      'api-token': { username, password: secret },
      pat: { token: secret },
    }[auth];
    db.run('INSERT INTO connections(id,user_id,service_id,method_id,name,config_enc,credentials_enc,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      id, owner.id, service, auth, id, encrypt(config), encrypt(credentials), now, now);
    return { id, authorization: auth === 'api-token' ? basic : bearer };
  }

  async function call(connection, {
    target = url, method = 'GET', status = 200, contentType = 'application/json',
    body = JSON.stringify(profile), preview, retry = false, cancel = false,
  } = {}) {
    let requests = 0;
    globalThis.fetch = async (input, init) => {
      requests++;
      assert.equal(String(input), target);
      assert.equal(init.method, method);
      assert.equal(new Headers(init.headers).get('authorization'), connection.authorization);
      if (retry && requests === 1) return new Response('retry', { status: 401 });
      return new Response(body, { status, headers: { 'content-type': contentType, 'x-fixture': 'upstream' } });
    };
    const before = db.all('SELECT audit_id FROM audit_outputs').length;
    const { response, auditId } = await execute(owner, connection.id, { method, url: target }, undefined, caller);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('content-type'), contentType);
    assert.equal(response.headers.get('x-fixture'), 'upstream');
    if (cancel) await response.body.cancel();
    else assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(body ?? ''));
    assert.equal(requests, retry ? 2 : 1);
    assert.ok(auditId);
    assert.deepEqual(output.readOutput(owner.id, auditId, true).preview, preview);
    assert.equal(output.readOutput(owner.id, auditId, false).preview, undefined);
    assert.throws(() => output.readOutput(other.id, auditId, true), { status: 404 });
    assert.equal(db.all('SELECT audit_id FROM audit_outputs').length, before + Number(preview !== undefined));
    return auditId;
  }

  const oauth = connect('bitbucket', 'oauth');
  const token = connect('bitbucket', 'api-token');
  for (const connection of [oauth, token]) {
    await call(connection, { preview: expected });
    await call(connection, { body: JSON.stringify({ ...profile, type: secret }) });
    await call(connection, { target: url + '?fields=type' });
    await call(connection, { target: url + '/' });
    await assert.rejects(call(connection, { target: 'https://other.example.invalid/2.0/user' }), {
      status: 400,
      message: /not an allowed host/,
    });
    await call(connection, { method: 'POST' });
    await call(connection, { status: 403 });
    await call(connection, { status: 204, body: null });
    await call(connection, { contentType: 'application/octet-stream' });
    await call(connection, { cancel: true });
    for (const body of ['{invalid', '{}', '{"type":42}', '{"type":{"value":"user"}}']) {
      await call(connection, { body });
    }
  }
  const auditId = await call(token, { preview: expected, retry: true });
  const { api } = await load('server/routes/connections.ts');
  api.onError((error, context) => context.json({ error: error.message }, error.status ?? 500));
  const reveal = (secret, suffix = 'output') => api.request(`/audit/${auditId}/${suffix}`, {
    headers: { authorization: 'Bearer ' + secret },
  });
  const full = createToken(owner.id, 'full fixture token', null);
  const scoped = createToken(owner.id, 'scoped fixture token', [token.id]);
  const revealed = await reveal(full.secret);
  assert.equal(revealed.status, 200);
  assert.deepEqual((await revealed.json()).preview, expected);
  assert.equal((await (await reveal(full.secret, 'output/status')).json()).preview, undefined);
  assert.equal((await reveal(scoped.secret)).status, 403);
  const maxValue = 'é'.repeat(16);
  await call(token, { body: JSON.stringify({ type: maxValue }), preview: { type: maxValue } });
  await call(token, { body: JSON.stringify({ type: maxValue + 'x' }) });
  const padding = 16_384 - Buffer.byteLength(JSON.stringify({ ...profile, padding: '' }));
  await call(token, { body: JSON.stringify({ ...profile, padding: 'x'.repeat(padding) }), preview: expected });
  await call(token, { body: JSON.stringify({ ...profile, padding: 'x'.repeat(padding + 1) }) });

  // Same route and origin through PAT isolates the auth-method exclusion.
  await call(connect('bitbucket', 'pat', { site: 'https://api.bitbucket.org' }));
  for (const [service, route] of [['jira', '/rest/api/3/myself'], ['confluence', '/wiki/rest/api/user/current']]) {
    await call(connect(service, 'oauth', { cloudId: 'demo' }), {
      target: `https://api.atlassian.com/ex/${service}/demo${route}`,
    });
    await call(connect(service, 'api-token', { site: 'demo' }), { target: 'https://demo.atlassian.net' + route });
    await call(connect(service, 'pat', { site: 'https://internal.example.invalid' }), {
      target: 'https://internal.example.invalid' + route,
    });
  }

  output.setOutputRetention(0);
  assert.equal(db.all('SELECT audit_id FROM audit_outputs').length, 0);
  await call(token);
  output.setOutputRetention(4);
  config.previewStoreId = undefined;
  output.initOutputStore();
  await call(token);
  console.log('Atlassian activity preview integration passed.');
} finally {
  globalThis.fetch = originalFetch;
  await plugins?.stop();
  database?.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
