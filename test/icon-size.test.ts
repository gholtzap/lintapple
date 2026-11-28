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
const rule = { selector: '.icon', sizes: [18] };
const policy: Partial<Policy> = { iconSizeRules: [rule] };
const fixture = (size = 22, css = '', body = '<span class="icon" aria-hidden="true"></span>') => `<!doctype html><html lang="en"><style>
html { background:white; color:#222; font:14px system-ui; } body { margin:24px; }
.row { display:flex; align-items:center; gap:10px; height:40px; }
.icon { display:block; width:${size}px; height:${size}px; flex:none; background:#888; ${css} }
</style><body><div class="row">${body}<span>Overview</span></div></body></html>`;

test('icon-size policy is optional and rejects invalid selectors, sizes, and fields', () => {
  assert.deepEqual(validatePolicy().iconSizeRules, []);
  assert.deepEqual(validatePolicy(policy).iconSizeRules, [rule]);
  for (const invalid of [null, {}, [], { ...rule, selector: '' }, { ...rule, sizes: [] }, { ...rule, sizes: null },
    { ...rule, sizes: [0] }, { ...rule, sizes: [-1] }, { ...rule, sizes: ['18'] }, { ...rule, sizes: [NaN] },
    { ...rule, sizes: [Infinity] }, { ...rule, typo: 18 }])
    assert.throws(() => validatePolicy({ iconSizeRules: [invalid] }), /icon.size|iconSizeRules/i);
  assert.throws(() => validatePolicy({ iconSizeRules: {} }), /iconSizeRules/);
});

test('icon-size measures selected rendered boxes and uses the first matching rule', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const entry of [
        { name: '22 px icon', html: fixture(), count: 1 },
        { name: '18 px icon', html: fixture(18), count: 0 },
        { name: 'tolerance', html: fixture(18.05), count: 0 },
        { name: 'beyond tolerance', html: fixture(18.25), count: 1 },
        { name: 'non-square icon', html: fixture(18, 'height:22px;'), count: 1 },
        { name: 'border included', html: fixture(18, 'border:2px solid #333;'), count: 1 },
        { name: 'transform included', html: fixture(36, 'transform:scale(.5);'), count: 0 },
        { name: 'transform failure', html: fixture(18, 'transform:scale(2);'), count: 1 },
        { name: 'negative scale', html: fixture(18, 'transform:scaleX(-1);'), count: 0 },
        { name: 'hidden icon', html: fixture(22, 'display:none;'), count: 0 },
        { name: 'transparent icon', html: fixture(22, 'opacity:0;'), count: 0 },
        { name: 'SVG icon', html: fixture(18, '', '<svg class="icon" aria-hidden="true" viewBox="0 0 18 18"></svg>'), count: 0 },
        { name: 'large SVG icon', html: fixture(22, '', '<svg class="icon" aria-hidden="true" viewBox="0 0 18 18"></svg>'), count: 1 },
        { name: 'image icon', html: fixture(18, '', '<img class="icon" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">'), count: 0 },
        { name: 'unselected icon', html: fixture(22, '', '<span style="width:22px;height:22px;display:block;background:#888"></span>'), count: 0 },
      ]) {
        await page.setContent(entry.html);
        const defaults = await checkPage(page);
        assert.equal(defaults.findings.filter(item => item.rule === 'icon-size').length, 0);
        const findings = (await checkPage(page, policy)).findings.filter(item => item.rule === 'icon-size');
        assert.equal(findings.length, entry.count, `${width}: ${entry.name}`);
        assert.ok(findings.every(item => item.actual.includes('px') && item.expected.includes('18')));
      }
    }
    await page.setContent(fixture(22));
    assert.equal((await checkPage(page, { iconSizeRules: [{ selector: '.icon', sizes: [22, 24] }, rule] })).findings.filter(item => item.rule === 'icon-size').length, 0);
    await page.setContent(fixture(18, 'height:22px;'));
    assert.equal((await checkPage(page, { iconSizeRules: [{ selector: '.icon', sizes: [18, 22] }] })).findings.filter(item => item.rule === 'icon-size').length, 1, 'Width and height must match the same allowed size.');
    const excepted = await checkPage(page, { ...policy, exceptions: [{ selector: '.icon', rules: ['icon-size'], reason: 'Test exception.' }] });
    assert.equal(excepted.findings.filter(item => item.rule === 'icon-size').length, 0);
    assert.equal(excepted.suppressed.filter(item => item.rule === 'icon-size').length, 1);
    await assert.rejects(checkPage(page, { iconSizeRules: [{ selector: '[', sizes: [18] }] }));
  } finally { await browser.close(); }
});

test('icon-size API and CLI retain opt-in reports and corrected controls', async () => {
  await mkdir('test-results/icon-size', { recursive: true });
  const config = resolve('test-results/icon-size/policy.json');
  await writeFile(config, JSON.stringify(policy));
  const records: { version: string; exitCode: number; findings: number }[] = [];
  const browser = await chromium.launch();
  try {
    for (const [version, size] of [['before', 22], ['after', 18]] as const) {
      const file = resolve(`test-results/icon-size/${version}.html`);
      await writeFile(file, fixture(size));
      const url = pathToFileURL(file).href;
      const api = await checkUrl(url, policy);
      const expected = version === 'before' ? 2 : 0;
      assert.equal(api.findings.filter(item => item.rule === 'icon-size').length, expected);
      assert.equal(api.findings.length, expected);
      await writeFile(`test-results/icon-size/${version}-api.json`, JSON.stringify(api, null, 2));
      let stdout: string;
      let exitCode = 0;
      try { ({ stdout } = await execute(process.execPath, ['dist/bin/lintapple.js', url, '--config', config, '--json'])); }
      catch (error) { assertProcessError(error); assert.equal(error.code, 1); stdout = error.stdout; exitCode = 1; }
      const report: UrlReport = JSON.parse(stdout);
      assert.equal(report.findings.length, expected);
      assert.equal(exitCode, expected ? 1 : 0);
      await writeFile(`test-results/icon-size/${version}-cli.json`, stdout);
      records.push({ version, exitCode, findings: report.findings.length });
      for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        const page = await browser.newPage({ viewport });
        await page.goto(url);
        await page.screenshot({ path: `test-results/icon-size/${version}-${viewport.width}.png` });
        await page.close();
      }
    }
    const file = pathToFileURL(resolve('test-results/icon-size/before.html')).href;
    assert.deepEqual((await checkUrl(file)).findings, []);
    const result = await execute(process.execPath, ['dist/bin/lintapple.js', file, '--json']);
    const defaultReport: UrlReport = JSON.parse(result.stdout);
    assert.deepEqual(defaultReport.findings, []);
    await writeFile('test-results/icon-size/default-cli.json', result.stdout);
    await writeFile('test-results/icon-size/receipt.json', JSON.stringify(records, null, 2));
  } finally { await browser.close(); }
});

test('icon sizes stay stable through single and nested scrolling without accepting permanent clips', async () => {
  const directory = resolve('test-results/icon-size/scrolling');
  await mkdir(directory, { recursive: true });
  const config = resolve(directory, 'policy.json');
  const scrollingPolicy: Partial<Policy> = { iconSizeRules: [{ selector: '.icon', sizes: [24] }], viewports: [{ width: 390, height: 720 }, { width: 1440, height: 720 }], colorSchemes: ['light', 'dark'] };
  await writeFile(config, JSON.stringify(scrollingPolicy));
  const browser = await chromium.launch();
  try {
    for (const axis of ['X', 'Y']) for (const mode of ['single', 'nested', 'permanent', 'unreachable']) {
      const offset = mode === 'unreachable' ? -4 : 100;
      const pageHtml = `<!doctype html><html lang="en"><title>Scrollable icon</title><style>
html{background:white;color:#111;font:16px system-ui}body{margin:24px}
#shell,#outer,#scroll{width:120px;height:120px}#shell{overflow:hidden}
#outer{overflow:${mode === 'nested' ? 'auto' : 'visible'}}
#scroll{position:relative;overflow:${mode === 'permanent' ? 'visible' : 'auto'};${mode === 'nested' ? `margin-${axis === 'X' ? 'left' : 'top'}:100px;` : ''}}
.icon{position:absolute;left:${axis === 'X' ? offset : 0}px;top:${axis === 'Y' ? offset : 0}px;width:24px;height:24px;background:#444}
</style><body><div id="shell"><div id="outer"><div id="scroll"><span class="icon" aria-hidden="true"></span></div></div></div><p>Projects</p></body></html>`;
      const file = resolve(directory, `${axis}-${mode}.html`);
      await writeFile(file, pageHtml);
      const fails = mode === 'permanent' || mode === 'unreachable';
      for (const viewport of scrollingPolicy.viewports!) for (const colorScheme of scrollingPolicy.colorSchemes!) {
        const page = await browser.newPage({ viewport, colorScheme });
        try {
          await page.goto(pathToFileURL(file).href);
          for (const scroll of [0, 10000]) {
            await page.locator('#outer, #scroll').evaluateAll((elements, scroll) => elements.forEach(el => { el.scrollLeft = el.scrollTop = scroll; }), scroll);
            const positions = await page.locator('#outer, #scroll').evaluateAll(elements => elements.map(el => [el.scrollLeft, el.scrollTop]));
            const report = await checkPage(page, scrollingPolicy);
            assert.equal(report.findings.some(f => f.rule === 'icon-size'), fails, `${axis}/${mode}/${viewport.width}/${colorScheme}/${scroll}: ${JSON.stringify(report.findings)}`);
            assert.deepEqual(await page.locator('#outer, #scroll').evaluateAll(elements => elements.map(el => [el.scrollLeft, el.scrollTop])), positions);
          }
        } finally { await page.close(); }
      }
      let code = 0, stdout: string;
      try { ({ stdout } = await execute(process.execPath, ['dist/bin/lintapple.js', pathToFileURL(file).href, '--config', config, '--json'])); }
      catch (error) { assertProcessError(error); assert.equal(typeof error.code, 'number'); code = Number(error.code); stdout = error.stdout; }
      const report: UrlReport = JSON.parse(stdout);
      await writeFile(`${file}.json`, stdout);
      assert.equal(code, fails ? 1 : 0, `${axis}/${mode}`);
      for (const run of report.runs) assert.equal(run.states[0].findings.some(f => f.rule === 'icon-size'), fails, `${axis}/${mode}`);
    }
  } finally { await browser.close(); }
});
