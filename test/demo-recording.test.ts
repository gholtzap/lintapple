import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const saved = '{"saved":"previous evidence"}\n';
const matrix = `${JSON.stringify({ command: 'npm run demo:check', origin: 'http://127.0.0.1:1234', policy: 'ui-policy.json', examples: [] }, null, 2)}\n`;

async function record(checks: string, external = false) {
  const directory = await mkdtemp(join(tmpdir(), 'lintapple-demo-recording-'));
  try {
    for (const path of ['dist/scripts', 'dist/test', 'demo', 'test-results']) await mkdir(join(directory, path), { recursive: true });
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    await cp(new URL('../scripts/record-demo.js', import.meta.url), join(directory, 'dist/scripts/record-demo.js'));
    await writeFile(join(directory, 'demo/reports.json'), saved);
    await writeFile(join(directory, 'test-results/demo-matrix.json'), '{"stale":true}');
    await writeFile(join(directory, 'dist/test/demo.test.js'), `
      import assert from 'node:assert/strict';
      import { readFile, writeFile } from 'node:fs/promises';
      import { test } from 'node:test';
      const snapshot = new URL('../../demo/reports.json', import.meta.url);
      const output = new URL('../../test-results/demo-matrix.json', import.meta.url);
      const expected = ${JSON.stringify(matrix)};
      const saved = ${JSON.stringify(saved)};
      ${checks}
    `);
    const env = { ...process.env };
    delete env.LINTAPPLE_ORIGIN;
    delete env.NODE_TEST_CONTEXT;
    if (external) env.LINTAPPLE_ORIGIN = 'https://example.com';
    const result = spawnSync(process.execPath, ['dist/scripts/record-demo.js'], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(result.error, undefined);
    return {
      status: result.status,
      output: `${result.stdout}\n${result.stderr}`,
      snapshot: await readFile(join(directory, 'demo/reports.json'), 'utf8'),
      savedFiles: await readdir(join(directory, 'demo')),
      matrix: await readFile(join(directory, 'test-results/demo-matrix.json'), 'utf8').catch(() => null),
    };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('demo recording promotes the complete matrix only after every check passes', async () => {
  const result = await record(`
    test('matrix', () => writeFile(output, expected));
    test('last gallery check', async () => assert.equal(await readFile(snapshot, 'utf8'), saved));
  `);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.snapshot, matrix);
  assert.equal(result.matrix, matrix);
  assert.deepEqual(result.savedFiles, ['reports.json']);
});

test('a later demo failure leaves saved evidence unchanged', async () => {
  const result = await record(`
    test('matrix', () => writeFile(output, expected));
    test('last gallery check', () => assert.fail('Gallery failure after the matrix was written'));
  `);
  assert.notEqual(result.status, 0, result.output);
  assert.equal(result.snapshot, saved);
  assert.equal(result.matrix, matrix);
  assert.deepEqual(result.savedFiles, ['reports.json']);
});

test('demo recording cannot promote a stale matrix when the runner writes no new evidence', async () => {
  const result = await record("test('no new matrix', () => {});");
  assert.notEqual(result.status, 0, result.output);
  assert.equal(result.snapshot, saved);
  assert.equal(result.matrix, null);
  assert.deepEqual(result.savedFiles, ['reports.json']);
});

test('demo recording rejects an external origin before running tests or changing evidence', async () => {
  const result = await record("test('must not run', () => writeFile(output, expected));", true);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /LINTAPPLE_ORIGIN/);
  assert.equal(result.snapshot, saved);
  assert.equal(result.matrix, '{"stale":true}');
  assert.deepEqual(result.savedFiles, ['reports.json']);
});
