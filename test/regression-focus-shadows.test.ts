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
import type { CliResult } from './types.js';
import { html } from './audit-cases.js';

const cases: { name: string; shadow: string; painted: boolean; initial?: string }[] = [
  { name: 'transparent', shadow: '0 0 0 4px rgba(0,0,255,0)', painted: false },
  { name: 'modern-transparent', shadow: '0 0 0 4px color(srgb 0 0 1 / 0)', painted: false },
  { name: 'zero-size', shadow: '0 0 0 0 blue', painted: false },
  { name: 'blue', shadow: '0 0 0 4px blue', painted: true },
  { name: 'layered', shadow: '0 0 0 2px transparent, 0 0 0 4px blue', painted: true },
  { name: 'inset', shadow: 'inset 0 0 0 3px blue', painted: true },
  { name: 'unchanged-outline', shadow: '0 0 0 4px transparent', painted: false, initial: 'outline:2px solid blue' },
  { name: 'unchanged-shadow-prefix', shadow: '0 0 0 4px transparent, 0 0 0 2px blue', painted: false, initial: 'box-shadow:0 0 0 2px blue' },
  { name: 'unchanged-shadow', shadow: '0 0 0 2px blue, 0 0 0 4px transparent', painted: false, initial: 'box-shadow:0 0 0 2px blue' },
];
const button = (shadow: string, initial = '') => html(`button{outline:none;border:1px solid #111;padding:8px 16px;${initial}}button:focus-visible{box-shadow:${shadow}}`, '<button id="save">Save preferences</button>');

test('CLI focus checks require a painted shadow rather than a computed-style change', async () => {
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/focus-shadows-'));
  await writeFile(join(directory, 'policy.json'), JSON.stringify({ colorSchemes: ['light', 'dark'] }));
  await writeFile(join(directory, 'plan.json'), JSON.stringify({ focus: [{ selector: '#save' }] }));
  const server = createServer((request, response) => {
    const entry = cases.find(entry => request.url === `/${entry.name}`);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.statusCode = entry ? 200 : 404;
    response.end(entry ? button(entry.shadow, entry.initial) : 'Page not found');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  try {
    for (const entry of cases) {
      await writeFile(join(directory, `${entry.name}.html`), button(entry.shadow, entry.initial));
      for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
        try {
          await page.goto(`${origin}/${entry.name}`);
          const before = await page.screenshot({ path: join(directory, `${entry.name}-${width}-${colorScheme}-before.png`) });
          await page.keyboard.press('Tab');
          assert.equal(await page.locator('#save').evaluate(el => el === document.activeElement), true);
          const focused = await page.screenshot({ path: join(directory, `${entry.name}-${width}-${colorScheme}-focused.png`) });
          assert.equal(before.equals(focused), !entry.painted, entry.name);
        } finally { await page.close(); }
      }
      const result = await new Promise<CliResult>((resolve, reject: (reason?: unknown) => void) => {
        const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/lintapple.js', import.meta.url)), `${origin}/${entry.name}`, '--json', '--config', join(directory, 'policy.json'), '--interactions', join(directory, 'plan.json')]);
        let stdout = '', stderr = '';
        child.stdout.on('data', (chunk: Buffer) => stdout += chunk);
        child.stderr.on('data', (chunk: Buffer) => stderr += chunk);
        child.on('error', reject);
        child.on('close', code => resolve({ code, stdout, stderr }));
      });
      await writeFile(join(directory, `${entry.name}.json`), result.stdout);
      assert.equal(result.code, entry.painted ? 0 : 1, entry.name + result.stderr + result.stdout);
      const report = JSON.parse(result.stdout) as UrlReport;
      assert.equal(report.runs.length, 4);
      for (const run of report.runs) {
        assert.equal(run.accessibilityCoverage.interactions?.find(check => check.rule === 'focus-visible')?.status, entry.painted ? 'passed' : 'unresolved', entry.name);
        assert.deepEqual(run.states.flatMap(state => state.findings.map(finding => finding.rule)), []);
      }
      assert.deepEqual(report.findings.map(finding => [finding.rule, finding.status]), entry.painted ? [] : Array.from({ length: 4 }, () => ['focus-visible', 'unresolved']));
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject: (reason?: unknown) => void) => server.close(error => error ? reject(error) : resolve()));
  }
});
