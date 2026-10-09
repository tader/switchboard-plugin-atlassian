import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.data', '.build'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (/\.(js|ts)$/.test(file) && !file.endsWith('.d.ts')) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    }
  }
}
await walk(root);
for (const id of ['atlassian', 'bitbucket']) {
  const dir = path.join(root, 'plugins', id);
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'plugin.json'), 'utf8'));
  if (manifest.id !== id) throw new Error(`Invalid manifest: ${id}`);
  await fs.access(path.join(dir, manifest.main ?? 'index.ts'));
  await fs.access(path.join(dir, manifest.icon));
}
console.log('Syntax and both plugin manifests passed.');
