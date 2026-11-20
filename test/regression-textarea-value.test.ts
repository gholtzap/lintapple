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

const editor = html('label{display:block;margin-bottom:8px}textarea{display:block;width:260px;height:96px;padding:12px}', '<label for="summary">Project summary</label><textarea id="summary">A game-changing project.</textarea>');
const edits = [
  { name: 'Cleared summary', value: '', phrases: [] },
  { name: 'Approved summary', value: 'Review project requirements.', phrases: [] },
  { name: 'Prohibited summary', value: 'Unlock your potential with this project.', phrases: ['unlock your potential'] },
];

test('CLI copy checks read the displayed textarea value after real editing', async () => {
  await mkdir('test-results', { recursive: true });
  const directory = await mkdtemp(resolve('test-results/textarea-value-'));
  await writeFile(join(directory, 'editor.html'), editor);
  await writeFile(join(directory, 'policy.json'), JSON.stringify({ colorSchemes: ['light', 'dark'] }));
  const plan = { states: edits.map(({ name, value }) => ({ name, action: 'fill', selector: '#summary', value, ready: { selector: '#summary' } })) };
  await writeFile(join(directory, 'plan.json'), JSON.stringify(plan));
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(editor);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
      try {
        await page.goto(origin);
        for (const [index, edit] of edits.entries()) {
          await page.locator('#summary').fill(edit.value);
          assert.equal(await page.locator('#summary').inputValue(), edit.value);
          await page.screenshot({ path: join(directory, `${width}-${colorScheme}-${index}.png`), fullPage: true });
        }
      } finally { await page.close(); }
    }
    const result = await new Promise<CliResult>((resolve, reject: (reason?: unknown) => void) => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/lintapple.js', import.meta.url)), origin, '--json', '--config', join(directory, 'policy.json'), '--interactions', join(directory, 'plan.json')]);
      let stdout = '', stderr = '';
      child.stdout.on('data', (chunk: Buffer) => stdout += chunk);
      child.stderr.on('data', (chunk: Buffer) => stderr += chunk);
      child.on('error', reject);
      child.on('close', code => resolve({ code, stdout, stderr }));
    });
    await writeFile(join(directory, 'report.json'), result.stdout);
    assert.equal(result.code, 1, result.stderr);
    const report = JSON.parse(result.stdout) as UrlReport;
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) {
      assert.equal(run.states.length, 4);
      assert.deepEqual(run.states[0].findings.map(item => [item.rule, item.actual]), [['copy', 'game-changing']]);
      for (const [index, edit] of edits.entries()) {
        const state = run.states[index + 1];
        assert.equal(state.name, edit.name);
        assert.deepEqual(state.findings.map(item => [item.rule, item.actual]), edit.phrases.map(phrase => ['copy', phrase]), edit.name);
      }
    }
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject: (reason?: unknown) => void) => server.close(error => error ? reject(error) : resolve()));
  }
});
