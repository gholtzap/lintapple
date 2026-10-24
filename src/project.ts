import type { Policy } from './types.js';
import { readFile, writeFile, rename, rm, stat, chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { defaultPolicy, validatePolicy } from './index.js';

export function parseJson(source: string, path: string): unknown {
  try { return JSON.parse(source); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    error.message = `Invalid JSON in ${JSON.stringify(path)}: ${error.message}`;
    throw error;
  }
}

export async function loadProjectPolicy(path?: string): Promise<Partial<Policy>> {
  let source: string;
  try { source = await readFile(path ?? 'ui-policy.json', 'utf8'); }
  catch (error) {
    if (path === undefined && error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
  return validatePolicy(parseJson(source, path ?? 'ui-policy.json'));
}

export async function initProject() {
  const original = await readFile('package.json', 'utf8');
  const originalMode = (await stat('package.json')).mode & 0o777;
  const input = parseJson(original, 'package.json');
  const pkg = input as { [key: string]: unknown; scripts?: Record<string, unknown> };
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('package.json must be an object.');
  if (pkg.scripts !== undefined && (!pkg.scripts || typeof pkg.scripts !== 'object' || Array.isArray(pkg.scripts))) throw new Error('package.json scripts must be an object.');
  await loadProjectPolicy();
  let created = false;
  try {
    await writeFile('ui-policy.json', `${JSON.stringify(defaultPolicy, null, 2)}\n`, { flag: 'wx' });
    created = true;
  } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error; }
  const added = !Object.hasOwn(pkg.scripts ?? {}, 'lint:ui');
  if (added) {
    pkg.scripts = { ...pkg.scripts, 'lint:ui': 'lintapple http://localhost:3000' };
    const temporary = `.lintapple-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(pkg, null, 2)}\n`, { flag: 'wx' });
      await chmod(temporary, originalMode);
      if (await readFile('package.json', 'utf8') !== original) throw new Error('package.json changed during setup. Run lintapple init again.');
      await rename(temporary, 'package.json');
    } finally { await rm(temporary, { force: true }); }
  }
  console.log(`${created ? 'Created' : 'Kept'} ui-policy.json. ${added ? 'Added' : 'Kept'} the lint:ui script.`);
  console.log('Set your fonts and text sizes in ui-policy.json. Set the app URL in the lint:ui script.');
  console.log('Start your app, then run npm run lint:ui.');
}
