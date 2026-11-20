import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execute = promisify(execFile);

test('concurrent asset builds preserve complete files and copy later source changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lintapple assets '));
  try {
    for (const path of ['demo/assets', 'examples', 'dist/scripts']) await mkdir(join(root, path), { recursive: true });
    await cp(new URL('../scripts/build-assets.js', import.meta.url), join(root, 'dist/scripts/build-assets.js'));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await writeFile(join(root, 'ui-policy.json'), '{"fonts":["system-ui"]}');
    await writeFile(join(root, 'demo/source.ts'), 'export const value = 1;');
    const assets = new Map<string, string>([['examples/ui.css', 'html { color: black; }']]);
    for (let index = 0; index < 32; index++) assets.set(`demo/assets/asset-${index}.css`, `/* ${index} */\n`.repeat(1024));
    for (const [path, content] of assets) await writeFile(join(root, path), content);
    for (let round = 0; round < 3; round++) {
      const content = `html { color: rgb(${round}, 0, 0); }`;
      assets.set('examples/ui.css', content);
      await writeFile(join(root, 'examples/ui.css'), content);
      const builds = await Promise.allSettled(Array.from({ length: 8 }, () => execute(process.execPath, [join(root, 'dist/scripts/build-assets.js')], { cwd: root })));
      assert.deepEqual(builds.filter(build => build.status === 'rejected'), []);
      for (const [path, expected] of assets) assert.equal(await readFile(join(root, 'dist', path), 'utf8'), expected, path);
      assert.equal(await readFile(join(root, 'dist/ui-policy.json'), 'utf8'), '{"fonts":["system-ui"]}');
    }
    await assert.rejects(readFile(join(root, 'dist/demo/source.ts')), { code: 'ENOENT' });
    assert.deepEqual((await readdir(join(root, 'dist'))).filter(name => name.startsWith('.asset-')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
