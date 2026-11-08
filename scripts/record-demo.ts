import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

if (process.env.LINTAPPLE_ORIGIN) throw new Error('Remove LINTAPPLE_ORIGIN to record the local demo. Use npm run demo:check for external verification.');

const root = new URL('../../', import.meta.url);
const matrix = new URL('test-results/demo-matrix.json', root);
await rm(matrix, { force: true });
const result = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('../test/demo.test.js', import.meta.url))], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
else {
  const report = await readFile(matrix);
  const temporary = new URL(`demo/.reports-${randomUUID()}.json`, root);
  try {
    await writeFile(temporary, report, { flag: 'wx' });
    await rename(temporary, new URL('demo/reports.json', root));
  } finally { await rm(temporary, { force: true }); }
}
