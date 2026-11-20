import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { checkPage, checkUrl } from '../src/index.js';
import { expectUI } from '../src/playwright.js';
import { assertProcessError } from './assert-process-error.js';
import type { UrlReport } from '../src/types.js';

const execute = promisify(execFile);
const fixture = (inset: number, tag = 'button', extra = '', content = '<span>Choose project</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="2"/></svg>') => `<!doctype html><html lang="en"><style>
select {font:inherit;} html { background:#fff;color:#222;font:14px system-ui; } body {margin:24px;}
.control {position:relative;display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;width:240px;height:44px;border:2px solid #888;padding:0 ${inset}px;font:14px system-ui;color:#222;background:white;${extra}}
.control:focus-visible {outline:2px solid #222;outline-offset:2px;}
@media(prefers-color-scheme:dark) { html {background:#222;color:white;} .control {background:#222;color:white;} }
</style><body><${tag} class="control" ${tag === 'div' ? 'role="combobox" aria-expanded="false" aria-controls="choices" tabindex="0" aria-label="Project"' : ''}>${content}</${tag}><div id="choices" role="listbox" aria-label="Project" hidden></div></body></html>`;

test('default control content checks text and arrows at mobile and desktop sizes in both themes', async () => {
  await mkdir('test-results/default-control-content', { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
      for (const inset of [0, 2, 8]) for (const tag of ['button', 'div']) {
        await page.setContent(fixture(inset, tag));
        for (const state of ['initial', 'hover', 'focus'] as const) {
          if (state === 'hover') await page.locator('.control').hover();
          if (state === 'focus') await page.locator('.control').focus();
          const report = await checkPage(page);
          const findings = report.findings.filter(item => item.rule === 'content-inset');
          assert.equal(findings.length, inset < 8 ? 2 : 0, `${width}/${colorScheme}/${inset}/${tag}/${state}`);
          if (inset < 8) assert.deepEqual(findings.map(item => item.actual), [`left inset ${inset}px`, `right inset ${inset}px`]);
          assert.equal(report.controlContentCoverage.checked, 1);
          assert.deepEqual(report.controlContentCoverage.unmeasured, []);
          await writeFile(`test-results/default-control-content/${width}-${colorScheme}-${tag}-${inset}-${state}.json`, JSON.stringify(report, null, 2));
        }
        if (tag === 'button') await page.screenshot({ path: `test-results/default-control-content/${width}-${colorScheme}-${inset}.png` });
      }
      await page.close();
    }
    const page = await browser.newPage();
    for (const entry of [
      { name: 'direct text', html: fixture(0, 'button', '', 'Save'), fails: true },
      { name: 'full-width wrapper has padded text', html: fixture(8, 'button', '', '<span style="width:100%">Save</span>'), fails: false },
      { name: 'icon only', html: fixture(8, 'button', '', '<svg aria-label="Save" width="16" height="16"></svg>'), fails: false },
      { name: 'fallback combobox role', html: fixture(2, 'div').replace('role="combobox"', 'role="unknown combobox"'), fails: true },
      { name: 'boxless control', html: fixture(2, 'div', 'display:contents;'), fails: false },
      { name: 'right-to-left', html: fixture(8, 'button', 'direction:rtl;'), fails: false },
      { name: 'absolute arrow ignores declared padding', html: fixture(8, 'button', '', '<span>Save</span><img alt="" style="position:absolute;right:2px;width:16px;height:16px" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E">'), fails: true },
      { name: 'border does not count', html: fixture(2, 'button', 'border-width:12px;'), fails: true },
      { name: 'scaled control', html: fixture(8, 'button', 'transform:scale(.5);transform-origin:top left;'), fails: true },
      { name: 'hidden arrow', html: fixture(8, 'button', '', '<span>Save</span><svg style="display:none"></svg>'), fails: false },
      { name: 'button inside a dialog', html: fixture(2).replace('<body>', '<body><div role="dialog" aria-label="Edit project">').replace('</body>', '</div></body>'), fails: true },
      { name: 'open popup content belongs to the popup', html: fixture(8, 'div', '', '<span>Project</span><div role="listbox" style="position:absolute;left:-20px;top:60px"><div role="option" aria-selected="true">Project</div></div>'), fails: false },
      { name: 'disabled button', html: fixture(2).replace('class="control"', 'class="control" disabled'), fails: true },
      { name: 'general container', html: fixture(0, 'section'), fails: false },
    ]) {
      await page.setContent(entry.html);
      const result = await checkPage(page);
      assert.equal(result.findings.some(item => item.rule === 'content-inset'), entry.fails, entry.name);
    }
    await page.setContent(fixture(2));
    const custom = await checkPage(page, { contentInsetRules: [{ selector: '.control', contentSelector: 'span, svg', insets: { left: 2, right: 2 } }] });
    assert.equal(custom.findings.filter(item => item.rule === 'content-inset').length, 0);
    const missing = await checkPage(page, { contentInsetRules: [{ selector: '.control', contentSelector: '.missing', insets: { right: 8 } }] });
    assert.equal(missing.controlContentCoverage.checked, 0);
    assert.match(missing.controlContentCoverage.unmeasured[0]!.reason, /no matching content/);
    const excepted = await checkPage(page, { exceptions: [{ selector: 'span, svg', rules: ['content-inset'], reason: 'Test exception.' }] });
    assert.equal(excepted.suppressed.filter(item => item.rule === 'content-inset').length, 2);
    await page.setContent(fixture(8, 'section', '', '<label>Project <select><option>Choose project</option></select></label>'));
    const native = await checkPage(page);
    assert.equal(native.controlContentCoverage.checked, 0);
    assert.match(native.controlContentCoverage.unmeasured[0]!.reason, /Native select/);
    const attachments: string[] = [];
    await expectUI(page, { attach: async (name) => { attachments.push(name); } });
    assert.deepEqual(attachments, ['lintapple coverage']);
    await page.setContent(fixture(8).replace('</style>', '.control::after {content:"";width:8px;height:8px;border-right:1px solid;} </style>'));
    assert.match((await checkPage(page)).controlContentCoverage.unmeasured[0]!.reason, /generated content/);
  } finally { await browser.close(); }
});

test('default control spacing reaches API, CLI findings, and native arrow coverage', async () => {
  await mkdir('test-results/default-control-content', { recursive: true });
  for (const inset of [2, 8]) {
    const file = resolve(`test-results/default-control-content/cli-${inset}.html`);
    await writeFile(file, fixture(inset));
    const url = pathToFileURL(file).href;
    const api = await checkUrl(url);
    assert.equal(api.findings.length, inset === 2 ? 4 : 0);
    let stdout: string;
    try { ({ stdout } = await execute(process.execPath, ['dist/bin/lintapple.js', url, '--json'])); assert.equal(inset, 8); }
    catch (error) { assertProcessError(error); assert.equal(error.code, 1); assert.equal(inset, 2); stdout = error.stdout; }
    const report: UrlReport = JSON.parse(stdout);
    assert.deepEqual(report.summary, api.summary);
    assert.ok(report.runs.every(run => run.controlContentCoverage.checked === 1 && run.states[0]!.controlContentCoverage.checked === 1));
    await writeFile(`test-results/default-control-content/cli-${inset}.json`, stdout);
  }
  const file = resolve('test-results/default-control-content/native.html');
  await writeFile(file, fixture(8, 'section', '', '<label>Project <select><option>Project</option></select></label>'));
  const { stdout } = await execute(process.execPath, ['dist/bin/lintapple.js', pathToFileURL(file).href]);
  assert.match(stdout, /Unmeasured control content:/);
  assert.match(stdout, /Native select label and arrow/);
  await writeFile('test-results/default-control-content/native-cli.txt', stdout);
});
