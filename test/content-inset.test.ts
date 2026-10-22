import type { Policy, UrlReport } from '../src/types.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { checkPage, checkUrl, validatePolicy } from '../src/index.js';
import { assertProcessError } from './assert-process-error.js';

const execute = promisify(execFile);
const rule = { selector: '.row', contentSelector: '.content', insets: { left: 8, right: 8 } };
const policy: Partial<Policy> = { contentInsetRules: [rule] };
const fixture = (padding = 0, row = '', content = '', body = '<span class="content">Overview</span>') => `<!doctype html><html lang="en"><style>
html { background:white; color:#222; font:14px system-ui; } body { margin:24px; min-height:80px; }
.row { box-sizing:border-box; display:flex; align-items:center; width:240px; height:40px; border:4px solid #ddd; padding:0 ${padding}px; ${row} }
.content { display:block; flex:1; ${content} }
</style><body><div class="row">${body}</div></body></html>`;

test('content-inset policy is optional and rejects invalid rules and edges', () => {
  assert.deepEqual(validatePolicy().contentInsetRules, []);
  assert.deepEqual(validatePolicy(policy).contentInsetRules, [rule]);
  assert.doesNotThrow(() => validatePolicy({ contentInsetRules: [{ ...rule, insets: { top: 0 } }] }));
  for (const invalid of [null, {}, { ...rule, selector: '' }, { ...rule, contentSelector: ' ' }, { ...rule, typo: 8 },
    { ...rule, insets: {} }, { ...rule, insets: null }, { ...rule, insets: [] }, { ...rule, insets: { start: 8 } },
    { ...rule, insets: { left: -1 } }, { ...rule, insets: { left: '8' } }, { ...rule, insets: { left: Infinity } }])
    assert.throws(() => validatePolicy({ contentInsetRules: [invalid] }), /content.inset|contentInsetRules/i);
  assert.throws(() => validatePolicy({ contentInsetRules: {} }), /contentInsetRules/);
});

test('content-inset checks rendered content, selected edges, nested rows, and exceptions', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const entry of [
        { name: 'no inset', html: fixture(), expected: ['left inset 0px', 'right inset 0px'] },
        { name: '8 px inset', html: fixture(8), expected: [] },
        { name: '7 px inset', html: fixture(7), expected: ['left inset 7px', 'right inset 7px'] },
        { name: 'fractional width', html: fixture(8, 'width:240.4px;'), expected: [] },
        { name: 'border does not count', html: fixture(0, 'border-width:20px;'), expected: ['left inset 0px', 'right inset 0px'] },
        { name: 'translated content', html: fixture(8, '', 'transform:translateX(-4px);'), expected: ['left inset 4px'] },
        { name: 'absolute content', html: fixture(8, 'position:relative;', 'position:absolute;left:0;right:8px;'), expected: ['left inset 0px'] },
        { name: 'scaled down', html: fixture(8, 'transform:scale(.5);transform-origin:top left;'), expected: ['left inset 4px', 'right inset 4px'] },
        { name: 'scaled up', html: fixture(4, 'transform:scale(2);transform-origin:top left;'), expected: [] },
        { name: 'flipped', html: fixture(8, 'transform:scaleX(-1);'), expected: [] },
        { name: 'hidden content', html: fixture(0, '', 'display:none;'), expected: [] },
        { name: 'no selected content', html: fixture(0, '', '', '<span>Overview</span>'), expected: [] },
        { name: 'hidden row', html: fixture(0, 'display:none;'), expected: [] },
        { name: 'nested row uses nearest matching row', html: fixture(0, 'height:auto;', '', '<div class="row" style="padding:8px"><span class="content">Overview</span></div>'), expected: [] },
      ]) {
        await page.setContent(entry.html);
        const defaults = await checkPage(page);
        assert.equal(defaults.findings.filter(item => item.rule === 'content-inset').length, 0);
        const findings = (await checkPage(page, policy)).findings.filter(item => item.rule === 'content-inset');
        assert.deepEqual(findings.map(item => item.actual), entry.expected, `${width}: ${entry.name}`);
        assert.ok(findings.every(item => item.relatedSelector && item.selector.endsWith('span:nth-of-type(1)')));
      }
    }
    await page.setContent(fixture());
    const vertical = await checkPage(page, { contentInsetRules: [{ ...rule, insets: { top: 20, bottom: 20 } }] });
    assert.deepEqual(vertical.findings.filter(item => item.rule === 'content-inset').map(item => item.actual.split(' ')[0]), ['top', 'bottom']);
    const first = await checkPage(page, { contentInsetRules: [{ ...rule, insets: { left: 0 } }, rule] });
    assert.equal(first.findings.filter(item => item.rule === 'content-inset').length, 0, 'First matching container rule applies.');
    const excepted = await checkPage(page, { ...policy, exceptions: [{ selector: '.content', rules: ['content-inset'], reason: 'Test exception.' }] });
    assert.equal(excepted.findings.filter(item => item.rule === 'content-inset').length, 0);
    assert.equal(excepted.suppressed.filter(item => item.rule === 'content-inset').length, 2);
    for (const invalid of [{ ...rule, selector: '[' }, { ...rule, contentSelector: '[' }])
      await assert.rejects(checkPage(page, { contentInsetRules: [invalid] }));
  } finally { await browser.close(); }
});

test('content-inset API and CLI retain opt-in reports and corrected controls', async () => {
  await mkdir('test-results/content-inset', { recursive: true });
  const config = resolve('test-results/content-inset/policy.json');
  await writeFile(config, JSON.stringify(policy));
  const records: { version: string; exitCode: number; findings: number }[] = [];
  const browser = await chromium.launch();
  try {
    for (const [version, padding] of [['before', 0], ['after', 8]] as const) {
      const file = resolve(`test-results/content-inset/${version}.html`);
      await writeFile(file, fixture(padding));
      const url = pathToFileURL(file).href;
      const api = await checkUrl(url, policy);
      const expected = version === 'before' ? 4 : 0;
      assert.equal(api.findings.filter(item => item.rule === 'content-inset').length, expected);
      assert.equal(api.findings.length, expected);
      await writeFile(`test-results/content-inset/${version}-api.json`, JSON.stringify(api, null, 2));
      let stdout: string;
      let exitCode = 0;
      try { ({ stdout } = await execute(process.execPath, ['dist/bin/lintapple.js', url, '--config', config, '--json'])); }
      catch (error) { assertProcessError(error); assert.equal(error.code, 1); stdout = error.stdout; exitCode = 1; }
      const report: UrlReport = JSON.parse(stdout);
      assert.equal(report.findings.length, expected);
      assert.equal(exitCode, expected ? 1 : 0);
      await writeFile(`test-results/content-inset/${version}-cli.json`, stdout);
      records.push({ version, exitCode, findings: report.findings.length });
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        const page = await browser.newPage({ viewport });
        await page.goto(url);
        await page.screenshot({ path: `test-results/content-inset/${version}-${viewport.width}.png` });
        await page.close();
      }
    }
    const file = pathToFileURL(resolve('test-results/content-inset/before.html')).href;
    const defaults = await checkUrl(file);
    assert.deepEqual(defaults.findings, []);
    const result = await execute(process.execPath, ['dist/bin/lintapple.js', file, '--json']);
    const defaultReport: UrlReport = JSON.parse(result.stdout);
    assert.deepEqual(defaultReport.findings, []);
    await writeFile('test-results/content-inset/default-cli.json', result.stdout);
    await writeFile('test-results/content-inset/receipt.json', JSON.stringify(records, null, 2));
  } finally { await browser.close(); }
});
