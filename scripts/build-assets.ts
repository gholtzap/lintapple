import { randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, rename, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'dist');

async function copyAsset(source: string, destination: string): Promise<void> {
  const temporary = join(output, `.asset-${randomUUID()}`);
  try {
    await cp(source, temporary);
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
}

async function copyAssets(source: string, destination: string): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.mts')) continue;
    const from = join(source, entry.name), to = join(destination, entry.name);
    if (entry.isDirectory()) await copyAssets(from, to);
    else await copyAsset(from, to);
  }
}

// TypeScript leaves output from removed modules in place.
const modules = await readdir(join(output, 'src')).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error;
  return [];
});
for (const entry of modules) {
  const source = entry.replace(/(?:\.d\.ts|\.js)(?:\.map)?$/, '.ts');
  if (source === entry) continue;
  try { await access(join(root, 'src', source)); }
  catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    await rm(join(output, 'src', entry), { force: true });
  }
}
for (const directory of ['demo', 'examples']) await copyAssets(join(root, directory), join(output, directory));
await copyAsset(join(root, 'ui-policy.json'), join(output, 'ui-policy.json'));
