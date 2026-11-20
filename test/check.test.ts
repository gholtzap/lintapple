import type { AddressInfo } from 'node:net';
import type { UrlReport } from '../src/types.js';
import type { CliResult } from './types.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';

const good = `<!doctype html><html lang="en"><style>
html { background: #fafafa; font-family: system-ui; font-size: 16px; }
body { margin: 24px; } h1 { font-size: 24px; }
button { font: inherit; min-height: 40px; padding: 8px 16px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
.number { font-variant-numeric: tabular-nums; text-align: right; }
.outer { border: 2px solid #ddd; border-radius: 20px; padding: 6px; }
.inner { border-radius: 12px; background: #eee; padding: 8px; }
</style><body><h1>Project</h1><div class="actions"><button>Save</button><button>Cancel</button></div>
<p class="number" data-ui-number>12,441</p><div class="outer" data-ui-radius><div class="inner" data-ui-radius-inner>Details</div></div>
<p hidden style="font-family:serif;font-size:99px">Hidden content</p>
<pre style="font-family:monospace;font-size:11px">code</pre></body></html>`;
const bad = good.replace('background: #fafafa', 'background: transparent')
  .replace('font-family: system-ui', 'font-family: serif').replace('font-size: 24px', 'font-size: 37px')
  .replace('min-height: 40px; padding: 8px 16px', 'height: 14px; padding: 0')
  .replace('gap: 8px', 'gap: 0px').replace('font-variant-numeric: tabular-nums', 'font-variant-numeric: normal')
  .replace('border-radius: 12px', 'border-radius: 20px')
  .replace('</body>', '<p>Unlock your potential</p><section data-ui-stack><p style="margin:0">First component</p><p style="margin:0">Second component</p></section><div style="width:2000px;height:1px"></div></body>');
const edge = good.replace('font-size: 24px', 'font-size: 12px').replace('class="actions"', 'class="actions" data-ui-actions')
  .replace('<h1>Project</h1>', '<h1><span>Project</span></h1>')
  .replace('<button>Save</button><button>Cancel</button>', '<div><button>Save</button></div><div><button>Cancel</button></div>')
  .replace('gap: 8px', 'gap: 0px')
  .replace('</body>', '<p>Unlock <span>your</span> potential</p><table><tr><td>123</td></tr></table></body>');

function cli(args: string[]) {
  return new Promise<CliResult>((resolve, reject: (reason?: unknown) => void) => {
    const child = spawn(process.execPath, ['dist/bin/lintapple.js', ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk: Buffer) => stdout += chunk);
    child.stderr.on('data', (chunk: Buffer) => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('CLI gives a page URL example for invalid URL arguments', async () => {
  for (const input of ['lint', 'http://']) {
    const result = await cli([input]);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Expected a page URL/);
    assert.ok(result.stderr.includes(JSON.stringify(input)));
    assert.match(result.stderr, /Include http:\/\/, https:\/\/, or file:\/\/\./);
    assert.match(result.stderr, /Example: lintapple http:\/\/localhost:3000/);
    assert.match(result.stderr, /lintapple --help/);
  }
});

test('CLI supplies a scheme and preserves explicit schemes and URL parts', async () => {
  const cases = [
    ['example.test:1/path?x=1#section', 'https://example.test:1/path?x=1#section'],
    ['127.example.test:1/path', 'https://127.example.test:1/path'],
    ['localhost:1/path', 'http://localhost:1/path'],
    ['localhost.:1/path', 'http://localhost.:1/path'],
    ['127.0.0.1:1/path', 'http://127.0.0.1:1/path'],
    ['[::1]:1/path', 'http://[::1]:1/path'],
    ['http://example.test:1/path', 'http://example.test:1/path'],
    ['https://localhost:1/path', 'https://localhost:1/path'],
  ];
  const results: {input: string; expected: string; exitCode: number | null; stderr: string}[] = [];
  for (const [input, expected] of cases) {
    const result = await cli([input]);
    assert.equal(result.code, 2);
    assert.ok(result.stderr.includes(`ERR_UNSAFE_PORT at ${expected}`), result.stderr);
    results.push({ input, expected, exitCode: result.code, stderr: result.stderr });
  }
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/url-defaults.json', JSON.stringify(results, null, 2));
});

test('CLI checks real pages, reports stable failures, and rejects invalid input', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/missing' || req.url === '/invalid.woff2') { res.writeHead(404); return res.end('Missing'); }
    res.setHeader('Content-Type', 'text/html');
    const fontPage = good.replace('<style>', '<style>@font-face { font-family: broken; src: url("/invalid.woff2"); }').replace('font-family: system-ui', 'font-family: broken, system-ui');
    const readyPage = good.replace('</body>', '<script>setTimeout(() => { document.querySelector("h1").style.fontSize = "37px"; document.body.setAttribute("data-app-ready", ""); }, 300);</script></body>');
    res.end(req.url === '/bad' ? bad : req.url === '/edge' ? edge : req.url === '/font' ? fontPage : req.url === '/ready' ? readyPage : good);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const pass = await cli([url, '--json']);
    assert.equal(pass.code, 0, pass.stderr);
    const passed: UrlReport = JSON.parse(pass.stdout);
    assert.equal(passed.findings.length, 0);
    assert.equal(passed.runs.length, 2);
    assert.ok(passed.runs.every(run => run.elements > 0));
    for (const host of ['127.0.0.1', 'localhost', 'localhost.']) {
      const implicit = await cli([`${host}:${(server.address() as AddressInfo).port}`, '--json']);
      assert.equal(implicit.code, 0, implicit.stderr);
      assert.equal(JSON.parse(implicit.stdout).url, `http://${host}:${(server.address() as AddressInfo).port}/`);
    }
    const fail = await cli([`${url}/bad`, '--json']);
    assert.equal(fail.code, 1, fail.stderr);
    const report: UrlReport = JSON.parse(fail.stdout);
    const expected = ['font-family', 'font-size', 'control-size', 'control-gap', 'content-inset', 'layout-gap', 'tabular-numbers', 'nested-radius', 'root-background', 'horizontal-overflow', 'viewport-bounds', 'text-contrast', 'copy'];
    assert.deepEqual([...new Set(report.findings.map(f => f.rule))].sort(), expected.sort());
    assert.ok(report.findings.every(f => f.selector && f.message && f.fix && f.viewport));
    assert.equal(report.summary.occurrences, report.findings.length);
    assert.ok(report.summary.problems < report.summary.occurrences);
    const text = await cli([`${url}/bad`]);
    assert.equal(text.code, 1);
    assert.match(text.stdout, /distinct problems/);
    assert.match(text.stdout, /unresolved/);
    assert.match(text.stdout, /Frame coverage:/);
    assert.equal(text.stdout.match(/Fix:/g)?.length, report.summary.problems);
    assert.match(text.stderr, /Policy:.*Approved fonts:/);
    const repeated: UrlReport = JSON.parse((await cli([`${url}/bad`, '--json'])).stdout);
    assert.deepEqual(repeated, report);
    const edgeReport: UrlReport = JSON.parse((await cli([`${url}/edge`, '--json'])).stdout);
    for (const rule of ['font-size', 'control-gap', 'copy', 'numeric-alignment', 'tabular-numbers'])
      assert.ok(edgeReport.findings.some(f => f.rule === rule), `Missing edge check: ${rule}`);
    assert.equal(edgeReport.findings.filter(f => f.rule === 'copy').length, 2, 'One copy finding per viewport');
    const fontReport: UrlReport = JSON.parse((await cli([`${url}/font`, '--json'])).stdout);
    assert.ok(fontReport.findings.some(f => f.rule === 'font-loading'));
    const readyReport: UrlReport = JSON.parse((await cli([`${url}/ready`, '--ready', '[data-app-ready]', '--json'])).stdout);
    assert.ok(readyReport.findings.some(f => f.rule === 'font-size'));
    const missing = await cli([`${url}/missing`, '--json']);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /404/);
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/bad-report.json', JSON.stringify(report, null, 2));
    const policy: import('../src/types.js').Policy = JSON.parse(await readFile('ui-policy.json', 'utf8'));
    policy.exceptions = [{ selector: 'h1', rules: ['font-size'], reason: 'Test heading uses a separate size.' }];
    await writeFile('test-results/policy.json', JSON.stringify(policy));
    const excepted: UrlReport = JSON.parse((await cli([`${url}/bad`, '--config', 'test-results/policy.json', '--json'])).stdout);
    assert.ok(!excepted.findings.some(f => f.rule === 'font-size'));
    assert.ok(excepted.findings.some(f => f.rule === 'font-family'));
    // @ts-expect-error Test rejection of a policy with an unknown rule.
    policy.exceptions[0].rules = ['typo'];
    await writeFile('test-results/policy.json', JSON.stringify(policy));
    const invalid = await cli([url, '--config', 'test-results/policy.json']);
    assert.equal(invalid.code, 2);
    assert.match(invalid.stderr, /Unknown rule/);
    policy.exceptions[0].rules = ['font-size'];
    policy.exceptions[0].selector = '[';
    await writeFile('test-results/policy.json', JSON.stringify(policy));
    assert.equal((await cli([url, '--config', 'test-results/policy.json'])).code, 2);
    assert.equal((await cli([url, '--typo'])).code, 2);
    const receipt = { command: 'npm test', inputs: 'test/check.test.js: good, bad, and edge-case HTML', expected: 'Good page passes. Bad page fails with twelve rule IDs. Repeat report is equal. Invalid input exits 2.', actual: 'All assertions passed.', environment: { node: process.version }, report: 'test-results/bad-report.json' };
    await writeFile('test-results/receipt.json', JSON.stringify(receipt, null, 2));
  } finally { await new Promise<void>((resolve, reject: (reason?: unknown) => void) => server.close(error => error ? reject(error) : resolve())); }
});

test('page API checks an entered dialog state and both example themes', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(good.replace('<button>Save</button>', '<button onclick="document.querySelector(\'dialog\').showModal()">Save</button>').replace('</body>', '<dialog><h2 style="font-size:37px">New project</h2></dialog></body>'));
    assert.equal((await checkPage(page)).findings.length, 0);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.ok((await checkPage(page)).findings.some(f => f.rule === 'font-size' && f.selector.includes('h2')));
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(new URL('../examples/good.html', import.meta.url).href);
      const result = await checkPage(page);
      assert.equal(result.findings.length, 0, JSON.stringify(result.findings));
    }
    await page.setContent(good);
    const button = page.getByRole('button', { name: 'Save', exact: true });
    await button.evaluate(el => { Object.assign(el.style, { width: '15px', height: '15px', minWidth: '0', minHeight: '0', padding: '0', border: '0' }); });
    assert.ok(!(await checkPage(page)).findings.some(f => f.rule === 'control-size'), '15 × 15 px meets the default minimum');
    await button.evaluate(el => { el.style.height = '14px'; });
    assert.ok((await checkPage(page)).findings.some(f => f.rule === 'control-size' && f.expected.includes('15px')), 'A 14 px height fails');
    await button.evaluate(el => { el.style.height = '15px'; el.style.width = '14px'; });
    assert.ok((await checkPage(page)).findings.some(f => f.rule === 'control-size'), 'A 14 px width fails');
  } finally { await browser.close(); }
});
