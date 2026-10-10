import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('CLI installs missing Chromium, retries failed setup, and reuses the cache', async () => {
  await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
  const cache = await mkdtemp(fileURLToPath(new URL('../test-results/browser cache-', import.meta.url)));
  const cli = (args, downloadHost) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.env.LINTAPPLE_CLI || fileURLToPath(new URL('../bin/lintapple.js', import.meta.url)), ...args], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: cache, ...(downloadHost ? { PLAYWRIGHT_DOWNLOAD_HOST: downloadHost, PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: '1000' } : {}) },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  try {
    const unavailable = 'http://127.0.0.1:9';
    const url = new URL('../examples/good.html', import.meta.url).href;
    const invalid = await cli(['ftp://example.com'], unavailable);
    assert.equal(invalid.code, 2);
    assert.doesNotMatch(invalid.stderr, /Downloading Chromium/);
    const failed = await cli([url, '--json'], unavailable);
    assert.equal(failed.code, 2);
    assert.match(failed.stderr, /Chromium setup failed/);
    assert.equal(failed.stdout, '');
    const first = await cli([url, '--json']);
    assert.equal(first.code, 0, first.stderr);
    assert.match(first.stderr, /Downloading Chromium/);
    assert.deepEqual(JSON.parse(first.stdout).findings, []);
    const next = await cli([url, '--json'], unavailable);
    assert.equal(next.code, 0, next.stderr);
    assert.doesNotMatch(next.stderr, /Downloading Chromium/);
    assert.deepEqual(JSON.parse(next.stdout), JSON.parse(first.stdout));
  } finally { await rm(cache, { recursive: true, force: true }); }
});
