import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/lintapple.js', import.meta.url));

test('CLI identifies failed files, invalid JSON, missing projects, bad options, refused connections, and missing pages', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'lintapple-cli-errors-'));
  const server = createServer((req, res) => { res.writeHead(404); res.end('Missing'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/missing`;
  const records = [];
  async function check(args, expected) {
    await assert.rejects(execute(process.execPath, [cli, ...args], { cwd }), error => {
      assert.equal(error.code, 2);
      assert.equal(error.stdout, '');
      for (const pattern of expected) assert.match(error.stderr, pattern);
      records.push({ args, exitCode: error.code, stderr: error.stderr });
      return true;
    });
  }
  try {
    await writeFile(join(cwd, 'bad.json'), '{');
    await check(['--url', '1sc.dev'], [/Unknown option: --url/, /lintapple <url>/, /lintapple --help/]);
    await check([url, '--config', join(cwd, 'missing.json')], [/Cannot find/, /missing\.json/, /Check the file path/]);
    await check([url, '--config', join(cwd, 'bad.json')], [/Invalid JSON in/, /bad\.json/, /line 1 column 2/]);
    await check([url, '--interactions', join(cwd, 'bad.json')], [/Invalid JSON in/, /bad\.json/]);
    await check(['init'], [/No package\.json in this directory/, /project directory/]);
    await check([url], [/Page not found:/, /HTTP 404/, /Check the page path/]);
    await new Promise(resolve => server.close(resolve));
    await check([url], [/Cannot connect to/, /server is running/, /address and port/]);
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/cli-error-report.json', JSON.stringify(records, null, 2));
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(cwd, { recursive: true, force: true });
  }
});

test('error text handles Node and browser disk errors and retains unrelated error details', async () => {
  const { formatCliError } = await import('../src/cli-error.js');
  for (const error of [Object.assign(new Error('write failed'), { code: 'ENOSPC' }), new Error('browserType.launch: ENOSPC: no space left on device')]) {
    assert.match(formatCliError(error), /Not enough disk space/);
    assert.match(formatCliError(error), /Free disk space/);
  }
  assert.equal(formatCliError(new Error('Distinct failure')), 'Distinct failure');
});
