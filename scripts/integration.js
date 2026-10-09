import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Actual installer, temporary database and mocked GitHub archive. No running instance is changed.
const source = path.resolve(process.env.SWITCHBOARD_ROOT ?? '../switchboard');
const root = path.resolve(import.meta.dirname, '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'atlassian-install-integration-'));
const originalFetch = globalThis.fetch;
let manager, database;
try {
  process.env.SWITCHBOARD_DATA_DIR = path.join(temporary, 'data');
  process.env.SWITCHBOARD_BUILTIN_PLUGINS_DIR = path.join(temporary, 'builtins');
  process.env.SWITCHBOARD_WATCH_PLUGINS = 'false';
  await fs.mkdir(process.env.SWITCHBOARD_DATA_DIR, { recursive: true });
  // Retain the old built-in to prove installed-plugin precedence and settings preservation.
  for (const id of ['oauth2', 'api-key', 'atlassian']) {
    let builtin = path.join(source, 'plugins', id);
    if (id === 'atlassian') {
      // Remain runnable after the migration patch removes the core copy.
      try { await fs.access(builtin); }
      catch { builtin = path.join(root, 'plugins', id); }
    }
    await fs.cp(builtin, path.join(process.env.SWITCHBOARD_BUILTIN_PLUGINS_DIR, id), { recursive: true });
  }
  const tar = createRequire(path.join(source, 'package.json'))('tar');
  const extracted = path.join(temporary, 'archive', 'repo');
  await fs.mkdir(extracted, { recursive: true });
  await fs.cp(path.join(root, 'plugins'), path.join(extracted, 'plugins'), { recursive: true });
  const archive = path.join(temporary, 'plugins.tgz');
  await tar.c({ gzip: true, file: archive, cwd: path.dirname(extracted) }, ['repo']);
  const contents = await fs.readFile(archive);
  globalThis.fetch = async input => {
    const url = String(input);
    if (url === 'https://api.github.com/repos/tader/switchboard-plugin-atlassian/commits/HEAD') return new Response('fixture-commit');
    if (url === 'https://api.github.com/repos/tader/switchboard-plugin-atlassian/tarball/fixture-commit') return new Response(contents);
    throw new Error(`Unexpected network request: ${url}`);
  };
  const load = file => import(pathToFileURL(path.join(source, 'server', file)).href);
  const crypto = await load('crypto.ts'); crypto.initKey();
  const db = await load('db.ts'); db.initDb(); database = db.db;
  db.run('INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)', 'fixture-user', 'fixture-user', db.now());
  db.run('INSERT INTO plugins (id, settings_enc) VALUES (?, ?)', 'atlassian', crypto.encrypt({ clientId: 'existing-client', clientSecret: 'existing-secret' }));
  for (const service of ['jira', 'confluence']) {
    db.run('INSERT INTO connections (id, user_id, service_id, method_id, name, account_id, config_enc, credentials_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      service, 'fixture-user', service, 'api-token', service, 'account@team.atlassian.net', crypto.encrypt({ site: 'team' }), crypto.encrypt({ username: 'user@example.com', password: 'fixture-token' }), db.now(), db.now());
  }
  const before = db.all('SELECT * FROM connections ORDER BY id');
  manager = (await load('plugins/manager.ts')).plugins;
  await manager.start();
  const github = await load('plugins/github.ts');
  const ids = await github.install({ repo: 'tader/switchboard-plugin-atlassian' });
  assert.deepEqual(ids.sort(), ['atlassian', 'bitbucket']);
  for (const id of ids) {
    assert.equal(manager.get(id).status, 'active', manager.get(id).error);
    assert.equal(manager.get(id).source.path, `plugins/${id}`);
  }
  assert.equal(manager.get('atlassian').overridesBuiltin, true);
  assert.deepEqual(manager.settingsForAdmin('atlassian').values, { clientId: 'existing-client' });
  assert.deepEqual(manager.settingsForAdmin('atlassian').secretsSet, ['clientSecret']);
  for (const service of ['jira', 'confluence', 'bitbucket']) assert.ok(manager.service(service));
  assert.deepEqual(db.all('SELECT * FROM connections ORDER BY id'), before);
  // Simulate core removing the built-in plugin, then restarting with saved settings/credentials.
  await manager.stop();
  await fs.rm(path.join(process.env.SWITCHBOARD_BUILTIN_PLUGINS_DIR, 'atlassian'), { recursive: true });
  await manager.start();
  assert.equal(manager.get('atlassian').status, 'active');
  assert.equal(manager.get('atlassian').overridesBuiltin, false);
  assert.deepEqual(db.all('SELECT * FROM connections ORDER BY id'), before);
  assert.equal(manager.service('jira').authMethods.find(m => m.id === 'oauth').unavailable, undefined);
  for (const id of ids) await github.uninstall(id);
  for (const id of ids) {
    const one = await github.install({ repo: 'tader/switchboard-plugin-atlassian', path: `plugins/${id}` });
    assert.deepEqual(one, [id]);
    assert.equal(manager.get(id).status, 'active');
    await github.uninstall(id);
  }
  console.log('Actual installer passed: both plugins, built-in override, saved settings/connections, core removal/restart and individual folder installs.');
} finally {
  await manager?.stop(); database?.close(); globalThis.fetch = originalFetch;
  await fs.rm(temporary, { recursive: true, force: true });
}
