import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Failure cases: lost or duplicate files, uneven measured work, invalid shards, and a hidden child failure.
test('CI shards balance recorded durations, cover every file once, and retain failures', async () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const root = await mkdtemp(join(tmpdir(), 'lintapple-ci-'));
  try {
    await mkdir(join(root, 'dist/test'), { recursive: true });
    await mkdir(join(root, 'dist/scripts'), { recursive: true });
    await mkdir(join(root, 'scripts'), { recursive: true });
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    const runner = join(root, 'dist/scripts/ci-tests.js');
    await cp(new URL('../scripts/ci-tests.js', import.meta.url), runner);
    await writeFile(join(root, 'scripts/test-timings.json'), JSON.stringify({ durationsMs: { 'a.test.js': 100, 'b.test.js': 60, 'c.test.js': 40, 'd.test.js': 20 } }));
    for (const name of ['a', 'b', 'c', 'd']) await writeFile(join(root, `dist/test/${name}.test.js`), `import {appendFileSync} from 'node:fs'; appendFileSync('visited', '${name}\\n');`);
    const selected: string[][] = [];
    for (let shard = 1; shard <= 3; shard++) {
      execFileSync(process.execPath, [runner, `--shard=${shard}/3`], { cwd: root, env });
      const receipt: { files: string[] } = JSON.parse(await readFile(join(root, `test-results/ci-tests-${shard}.json`), 'utf8'));
      selected.push(receipt.files);
    }
    assert.deepEqual(selected, [['a.test.js'], ['b.test.js'], ['c.test.js', 'd.test.js']]);
    assert.deepEqual((await readFile(join(root, 'visited'), 'utf8')).trim().split('\n').sort(), ['a', 'b', 'c', 'd']);
    for (const argument of ['--shard=0/3', '--shard=4/3', '--shard=1/0', '--shard=wat']) assert.notEqual(spawnSync(process.execPath, [runner, argument], { cwd: root, env }).status, 0);
    await writeFile(join(root, 'dist/test/a.test.js'), 'process.exitCode = 7;');
    assert.notEqual(spawnSync(process.execPath, [runner, '--shard=1/3'], { cwd: root, env }).status, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
