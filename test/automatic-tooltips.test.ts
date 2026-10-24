import { test } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expectUI } from '../src/playwright.js';
import { checkPage, checkUrl } from '../src/index.js';
import type { Policy, UrlReport } from '../src/types.js';
import { assertProcessError } from './assert-process-error.js';
const execute = promisify(execFile);
const directory = resolve('test-results/automatic-tooltips');
const policy: Partial<Policy> = { viewports: [{ width: 390, height: 844 }, { width: 1440, height: 900 }], colorSchemes: ['light', 'dark'] };
const fixture = (mode: string) => `<!doctype html><html lang="en"><style>
html{font:14px system-ui;background:white;color:#222}body{margin:24px}button{font:inherit;padding:8px;min-height:40px;margin-right:8px}
#tip{position:fixed;top:80px;right:8px;max-width:calc(100vw - 16px);padding:8px;background:#222;color:white;overflow-wrap:anywhere}
@media(prefers-color-scheme:dark){html{background:#222;color:white}#tip{background:white;color:#222}}
${mode === 'overflow' ? '#tip{right:-32px}' : mode === 'vertical' ? '#tip{position:absolute;top:calc(100vh + 8px)}' : ''}
</style><body><button id="trigger" aria-label="Download" ${mode.startsWith('lazy') ? 'data-ui-tooltip="tip"' : 'aria-describedby="tip"'}>${mode === 'lazy-icon' ? '<svg aria-hidden="true" width="16" height="16"><path d="M2 8h12" stroke="currentColor"/></svg>' : 'Download'}</button>
${mode.startsWith('lazy') ? '' : '<div id="tip" role="tooltip" hidden>Download review</div>'}
<button id="action" onclick="localStorage.setItem('clicked','yes')">Save</button>
<script>
const mode=${JSON.stringify(mode)},button=document.querySelector('#trigger');let tip=document.querySelector('#tip');let resized=false;
function open(){if(mode==='lazy-never-open')return;if(!tip){tip=document.createElement('div');tip.id='tip';tip.role='tooltip';tip.textContent='Download review';document.body.append(tip)}tip.hidden=false;if(mode==='resize')tip.style.right=resized?'-32px':'8px'}
function close(){if(tip)tip.hidden=true}
button.addEventListener('mouseenter',open);button.addEventListener('mouseleave',close);button.addEventListener('blur',close);
if(mode!=='hover-only')button.addEventListener('focus',open);
button.addEventListener('keydown',event=>{if(event.key==='Escape'&&mode!=='escape')close()});
window.addEventListener('resize',()=>{resized=true;if(mode==='resize'&&tip&&!tip.hidden)tip.style.right='-32px';if(mode==='close-on-resize')close()});
</script></body></html>`;

test('URL scans open declared tooltips and find defects that passive checks cannot see', async () => {
  await mkdir(directory, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const mode of ['lazy-icon', 'good', 'overflow', 'vertical', 'resize', 'close-on-resize', 'hover-only', 'escape', 'lazy']) {
      const file = resolve(directory, `${mode}.html`);
      await writeFile(file, fixture(mode));
      await page.goto(pathToFileURL(file).href);
      const passive = await checkPage(page);
      assert.equal(passive.findings.length, 0, `${mode}: passive check`);
      if (mode === 'lazy-icon') {
        assert.equal(passive.accessibilityCoverage.tooltips!.unmeasured.length, 1);
        const attachments: string[] = [];
        await expectUI(page, { attach: async name => { attachments.push(name); } });
        assert.deepEqual(attachments, ['lintapple coverage']);
      }
      assert.equal(await page.locator('#tip').isVisible(), false);
      const report = await checkUrl(pathToFileURL(file).href, policy);
      await writeFile(resolve(directory, `${mode}.json`), JSON.stringify(report, null, 2));
      if (['good', 'close-on-resize', 'lazy', 'lazy-icon'].includes(mode)) assert.deepEqual(report.findings, [], mode);
      else if (mode === 'hover-only') assert.ok(report.findings.some(item => item.phase === 'focus'), mode);
      else if (mode === 'escape') assert.ok(report.findings.some(item => item.phase === 'escape'), mode);
      else assert.ok(report.findings.some(item => item.rule === 'viewport-bounds'), mode);
      assert.ok(report.runs.every(run => run.states.some(state => state.name.includes('hover'))), mode);
      assert.ok(report.runs.every(run => run.states.some(state => state.name.includes('keyboard focus'))), mode);
      if (mode === 'resize') assert.ok(report.findings.some(item => item.state?.includes('resize') && item.viewport), 'Resize findings retain the actual viewport.');
      if (['good', 'lazy', 'lazy-icon'].includes(mode)) assert.ok(report.runs.every(run => run.accessibilityCoverage.tooltips?.checked.length === 1));
      if (mode === 'good' || mode === 'overflow') {
        await page.locator('#trigger').hover();
        await page.screenshot({ path: resolve(directory, `${mode}.png`) });
        await page.mouse.move(-1, -1);
      }
    }
  } finally { await browser.close(); }
});

test('CLI checks tooltips without a plan and reports undiscoverable or blocked tooltips', async () => {
  await mkdir(directory, { recursive: true });
  const config = resolve(directory, 'policy.json');
  await writeFile(config, JSON.stringify({ viewports: [{ width: 390, height: 844 }] }));
  for (const mode of ['overflow', 'good', 'lazy-never-open']) {
    const file = resolve(directory, `cli-${mode}.html`);
    await writeFile(file, fixture(mode));
    let stdout: string;
    try { ({ stdout } = await execute(process.execPath, ['dist/bin/lintapple.js', pathToFileURL(file).href, '--config', config, '--json'])); assert.equal(mode, 'good'); }
    catch (error) { assertProcessError(error); assert.equal(error.code, 1); assert.notEqual(mode, 'good'); stdout = error.stdout; }
    const report: UrlReport = JSON.parse(stdout);
    assert.equal(report.findings.some(item => item.rule === 'viewport-bounds'), mode === 'overflow');
    if (mode === 'lazy-never-open') assert.ok(report.findings.some(item => item.phase === 'hover'));
    await writeFile(resolve(directory, `cli-${mode}.json`), stdout);
  }
  const file = resolve(directory, 'unmeasured.html');
  await writeFile(file, fixture('good').replace('id="trigger"', 'id="trigger" disabled').replace('</body>', '<div role="tooltip" id="orphan" hidden>Unlinked tooltip</div><button title="Native tooltip">Help</button></body>'));
  const report = await checkUrl(pathToFileURL(file).href, { viewports: [{ width: 390, height: 844 }] });
  const coverage = report.runs[0]!.accessibilityCoverage.tooltips!;
  assert.equal(coverage.checked.length, 0);
  assert.equal(coverage.unmeasured.length, 3);
  const { stdout } = await execute(process.execPath, ['dist/bin/lintapple.js', pathToFileURL(file).href, '--config', config]);
  assert.match(stdout, /Unmeasured tooltip states/);
  await writeFile(resolve(directory, 'unmeasured-cli.txt'), stdout);
});

test('automatic scans preserve explicit tooltip plans and do not activate actions', async () => {
  const mutations: string[] = [];
  const server = createServer((request, response) => {
    if (request.method === 'POST') { mutations.push(request.url ?? ''); response.end('Saved'); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end(fixture('good').replace("localStorage.setItem('clicked','yes')", "fetch('/save',{method:'POST'})"));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await assert.rejects(checkUrl(url, {}, { interactions: { states: [{ name: 'automatic tooltips[0]: hover', action: 'hover', selector: '#trigger', ready: { selector: '#tip' } }] } }), /State names must be unique/);
    const report = await checkUrl(url, { viewports: [{ width: 390, height: 844 }] }, { interactions: { tooltips: [{ trigger: '#trigger', tooltip: '#tip' }] } });
    assert.deepEqual(report.findings, []);
    assert.equal(report.runs[0]!.states.filter(state => state.name.endsWith(': hover')).length, 1);
    assert.deepEqual(report.runs[0]!.accessibilityCoverage.tooltips!.checked, []);
    const automatic = await checkUrl(url, { viewports: [{ width: 390, height: 844 }] });
    assert.deepEqual(automatic.findings, []);
    assert.deepEqual(mutations, []);
    await writeFile(resolve(directory, 'no-activation.json'), JSON.stringify({ mutations, report: automatic }, null, 2));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
