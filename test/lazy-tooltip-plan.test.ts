import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertProcessError } from './assert-process-error.js';
import type { UrlReport } from '../src/types.js';
import { checkInteractions, checkPage, checkUrl } from '../src/index.js';
import { html } from './audit-cases.js';

const fixture = (mode: string) => html(`
  button { min-width:44px; min-height:44px; padding: 8px; }
  #alternate { margin-left: 16px; }
  [role="tooltip"] { position: fixed; top: 80px; left: 24px; padding: 8px; background: #111; color: white; }
`, `
  <button id="trigger" aria-label="Help"><svg aria-hidden="true" width="16" height="16"></svg></button>
  <button id="alternate">Save</button>
  <script>
    const trigger = document.querySelector('#trigger');
    const mode = ${JSON.stringify(mode)};
    let tip, id = 0;
    const open = () => {
      if (tip || mode === 'absent') return;
      tip = document.createElement('span');
      tip.id = 'tip-' + (++id);
      tip.setAttribute('role', 'tooltip');
      tip.textContent = 'Help with this field';
      document.body.append(tip);
      if (mode !== 'unlinked') trigger.setAttribute('aria-describedby', tip.id);
    };
    const close = () => { tip?.remove(); tip = null; trigger.removeAttribute('aria-describedby'); };
    trigger.addEventListener('mouseenter', open);
    trigger.addEventListener('mouseleave', () => {
      if (mode !== 'hoverable') { close(); return; }
      requestAnimationFrame(() => document.addEventListener('pointermove', close, { once: true }));
    });
    if (mode !== 'hover-only') trigger.addEventListener('focus', open);
    trigger.addEventListener('blur', close);
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        if (mode === 'persistent') trigger.removeAttribute('aria-describedby');
        else if (mode === 'renamed-orphan' || mode === 'renamed-hidden') { tip.id = 'renamed'; trigger.removeAttribute('aria-describedby'); tip.hidden = mode === 'renamed-hidden'; }
        else if (mode === 'replaced') { close(); open(); }
        else if (mode === 'orphan') { const ghost = tip.cloneNode(true); close(); ghost.id = 'orphan'; document.body.append(ghost); }
        else if (mode === 'orphan-self') { const ghost = tip.cloneNode(true); close(); ghost.id = 'orphan'; ghost.setAttribute('aria-describedby', ghost.id); document.body.append(ghost); }
        else if (mode === 'other-trigger') { const other = tip.cloneNode(true); close(); other.id = 'other-tip'; document.body.append(other); document.querySelector('#alternate').setAttribute('aria-describedby', other.id); }
        else close();
      }
    });
    trigger.addEventListener('click', () => document.body.dataset.clicked = 'yes');
  </script>
  ${mode === 'unrelated' ? '<span id="other-help" role="tooltip" style="left:400px">Other help</span>' : ''}
`);
const plan = { tooltips: [{ trigger: '#trigger' }], timeout: 600 };
const screen = { width: 800, height: 600 };
const policy = { viewports: [screen] };

test('trigger-only plans check the link on each opening and the tooltip on Escape', async () => {
  const browser = await chromium.launch({ channel: process.env.LINTAPPLE_BROWSER_CHANNEL || undefined });
  try {
    for (const [mode, expected] of [['good', null], ['renamed-hidden', null], ['hoverable', null], ['unrelated', null], ['other-trigger', null], ['absent', 'hover'], ['unlinked', 'tooltip-link'],
      ['hover-only', 'focus'], ['persistent', 'escape'], ['renamed-orphan', 'escape'], ['replaced', 'escape'], ['orphan', 'escape'], ['orphan-self', 'escape']] as const) {
      const page = await browser.newPage({ viewport: screen });
      await page.setContent(fixture(mode));
      const baseline = await checkPage(page);
      assert.ok(baseline.findings.some(f => f.rule === 'icon-button-tooltip'));
      const report = await checkInteractions(page, plan, policy);
      if (expected) assert.ok(report.findings.some(f => f.phase === expected), `${mode}: ${JSON.stringify(report.checks)}`);
      else {
        assert.deepEqual(report.findings.filter(f => f.rule === 'icon-button-tooltip'), []);
        for (const phase of ['hover', 'focus', 'escape', 'tooltip-escape-focus'])
          assert.ok(report.checks.some(check => check.phase === phase && check.status === 'passed'), phase);
      }
      assert.equal(await page.locator('body').getAttribute('data-clicked'), null, mode);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('URL checks defer only the declared trigger to the interaction plan', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(fixture('good').replace('>Save</button>', ' aria-label="Save"><svg aria-hidden="true" width="16" height="16"></svg></button>'));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const report = await checkUrl(url, policy, { interactions: plan });
    const initial = report.runs[0].states[0];
    const findings = initial.findings.filter(f => f.rule === 'icon-button-tooltip');
    assert.equal(findings.length, 1);
    assert.match(findings[0].selector, /button:nth-of-type\(2\)$/);
    assert.ok(report.runs[0].accessibilityCoverage.interactions?.some(c => c.phase === 'escape' && c.status === 'passed'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});


test('CLI tooltip plans reject visible orphan replacements in both themes and sizes', async () => {
  const directory = resolve('test-results/lazy-tooltip-cli');
  await mkdir(directory, { recursive: true });
  const config = resolve(directory, 'policy.json'), interactions = resolve(directory, 'plan.json');
  await writeFile(config, JSON.stringify({ viewports: [{ width: 390, height: 844 }, { width: 1440, height: 900 }], colorSchemes: ['light', 'dark'] }));
  await writeFile(interactions, JSON.stringify(plan));
  for (const mode of ['good', 'orphan', 'renamed-orphan']) {
    const file = resolve(directory, `${mode}.html`);
    await writeFile(file, fixture(mode));
    let stdout: string, code = 0;
    try { ({ stdout } = await promisify(execFile)(process.execPath, ['dist/bin/lintapple.js', pathToFileURL(file).href, '--config', config, '--interactions', interactions, '--json'])); }
    catch (error) { assertProcessError(error); assert.equal(typeof error.code, 'number'); code = Number(error.code); stdout = error.stdout; }
    const report: UrlReport = JSON.parse(stdout);
    await writeFile(`${file}.json`, stdout);
    assert.equal(code, mode === 'good' ? 0 : 1);
    assert.equal(report.runs.length, 4);
    for (const run of report.runs) {
      const checks = run.accessibilityCoverage.interactions ?? [];
      assert.ok(checks.some(check => check.phase === 'escape' && check.status === (mode === 'good' ? 'passed' : mode === 'orphan' ? 'unresolved' : 'failed')));
    }
  }
});
