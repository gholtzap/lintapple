import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import type { UrlReport } from '../src/types.js';

const preferences = (badText = false) => `<!doctype html><html lang="en"><meta charset="utf-8"><title>Account preferences</title>
<style>html{background:#fff;color:#111;font:16px system-ui}body{margin:24px}h1{font-size:24px}label{display:block;padding:12px 0}input{margin:0 8px 0 0}fieldset{margin:16px 0;padding:16px}legend{padding:0 8px}</style>
<body><h1>Account preferences</h1><form>
<label><input id="updates" type="checkbox">Send project updates</label>
<fieldset><legend>Notification frequency</legend><label><input id="daily" type="radio" name="frequency" value="daily" checked>Daily</label><label><input id="weekly" type="radio" name="frequency" value="weekly">Weekly</label></fieldset>
<label for="volume">Notification volume</label><input id="volume" type="range">
<label for="accent">Project color</label><input id="accent" type="color" value="#336699">
<label for="name">Project name</label><input id="name" value="Design review" style="font:${badText ? '17px serif' : '16px system-ui'}">
</form></body></html>`;

test('CLI font checks skip native inputs without text and still check text fields', async () => {
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/native-control-fonts-'));
  await writeFile(join(directory, 'preferences.html'), preferences());
  await writeFile(join(directory, 'policy.json'), JSON.stringify({ colorSchemes: ['light', 'dark'] }));
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(preferences(request.url === '/bad-text'));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
      try {
        await page.goto(origin);
        await page.locator('#updates').check();
        await page.locator('#weekly').check();
        assert.equal(await page.locator('#updates').isChecked(), true);
        assert.equal(await page.locator('#weekly').isChecked(), true);
        assert.equal(await page.locator('#daily').isChecked(), false);
        await page.screenshot({ path: join(directory, `${width}-${colorScheme}.png`), fullPage: true });
      } finally { await page.close(); }
    }
    for (const [route, exit] of [['/', 0], ['/bad-text', 1]] as const) {
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject: (reason?: unknown) => void) => {
        const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/lintapple.js', import.meta.url)), origin + route, '--json', '--config', join(directory, 'policy.json')]);
        let stdout = '', stderr = '';
        child.stdout.on('data', (chunk: Buffer) => stdout += chunk);
        child.stderr.on('data', (chunk: Buffer) => stderr += chunk);
        child.on('error', reject);
        child.on('close', code => resolve({ code, stdout, stderr }));
      });
      const report = JSON.parse(result.stdout) as UrlReport;
      await writeFile(join(directory, route === '/' ? 'valid.json' : 'bad-text.json'), result.stdout);
      assert.equal(result.code, exit, result.stderr + result.stdout);
      assert.equal(report.runs.length, 4);
      for (const run of report.runs) {
        const findings = run.states[0].findings;
        assert.deepEqual(findings.map(item => item.rule).sort(), route === '/' ? [] : ['font-family', 'font-size']);
        if (route !== '/') assert.ok(findings.every(item => item.selector.endsWith('input:nth-of-type(3)')));
      }
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject: (reason?: unknown) => void) => server.close(error => error ? reject(error) : resolve()));
  }
});
