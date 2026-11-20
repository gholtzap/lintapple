import { assertProcessError } from './assert-process-error.js';
import type { AddressInfo } from 'node:net';
import type { UrlReport, Policy, InteractionPlan } from '../src/types.js';
import type { CliResult } from './types.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
const { checkPage, checkUrl, checkInteractions, defaultPolicy } = await import(process.env.LINTAPPLE_PACKAGE || '../src/index.js') as typeof import('../src/index.js');
const execute = promisify(execFile);
const directory = resolve(process.env.LINTAPPLE_EVIDENCE_DIR || 'test-results/false-pass');
const shell = (content: string) => `<!doctype html><html lang="en"><title>Policy checks</title><style>
html{background:white;color:#202020;font:16px/24px system-ui}body{margin:24px}
button{font:16px system-ui;min-height:40px;padding:8px;background:white;color:#202020}
</style><body>${content}</body></html>`;
const cases: Record<string, string> = {
  contents: shell('<span style="display:contents;font:17px serif;color:#aaa">Project details</span>'),
  corrected: shell('<span style="display:contents">Project details</span>'),
  mixed: shell('<section>seamlessly<pre><code>seamlessly</code></pre></section>'),
  code: shell('<pre><code>seamlessly</code></pre>'),
  prose: shell('<section>seamlessly</section>'),
  split: shell('<p>Unlock <span>your</span> potential</p>'),
  blocks: shell('<section><p>Unlock</p><p>your potential</p></section>'),
  excluded: shell('<p>Unlock <code>your</code> potential</p>'),
  hidden: shell('<p hidden>seamlessly</p><p>Project details</p>'),
  button: shell('<button id="save" onclick="document.querySelector(\'#status\').textContent=\'Saved\'">Save</button><p id="status">Pending</p>'),
};
for (const mode of ['normal', 'contents', 'zero']) {
  const style = mode === 'contents' ? 'display:contents;' : mode === 'zero' ? 'height:0;' : '';
  for (const gap of [4, 8]) cases[`stack-${mode}-${gap}`] = shell(`<div data-ui-stack style="${style}font-size:0"><div style="display:inline-block;width:100px;height:40px;font-size:16px">First</div><div style="display:inline-block;width:100px;height:40px;font-size:16px;margin-left:${gap}px">Second</div></div>`);
  cases[`ready-${mode}`] = shell(`<button id="save" onclick="setTimeout(()=>document.querySelector('#text').textContent='Saved',100)">Save</button><div id="status" style="${style}"><span id="text">Pending</span></div>`);
}
for (const type of ['button', 'submit', 'reset']) {
  cases[`copy-${type}`] = shell(`<input type="${type}" style="font:16px system-ui" value="seamlessly">`);
  cases[`copy-${type}-corrected`] = cases[`copy-${type}`].replace('seamlessly', 'Save');
}
cases['copy-editable'] = shell('<label for="name">Project name</label><input id="name" style="font:16px system-ui" value="seamlessly">');
cases['copy-hidden'] = shell('<input type="submit" hidden value="seamlessly"><p>Project details</p>');
cases['stack-hidden'] = cases['stack-contents-4'].replace('<div data-ui-stack', '<div hidden><div data-ui-stack').replace('</body>', '</div><p>Project details</p></body>');

async function fixture(callback: (origin: string, cli: (route: string, args?: string[]) => Promise<CliResult>) => Promise<void>) {
  await mkdir(directory, { recursive: true });
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(cases[(request.url ?? '/').slice(1)] || cases.corrected);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cli = async (route: string, args: string[] = []) => {
    try { return { code: 0, ...await execute(process.execPath, [process.env.LINTAPPLE_CLI || 'dist/bin/lintapple.js', `${origin}/${route}`, '--json', ...args]) }; }
    catch (error) { assertProcessError(error); if (typeof error.code !== 'number') throw error; return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
  };
  try { await callback(origin, cli); }
  finally { await new Promise<void>((resolve, reject: (reason?: unknown) => void) => server.close(error => error ? reject(error) : resolve())); }
}

test('CLI checks visible boxless text and accepts its corrected state', async () => fixture(async (origin, cli) => {
  for (const route of ['contents', 'corrected']) {
    const output = await cli(route);
    assert.equal(output.code, route === 'contents' ? 1 : 0, output.stderr);
    const report: UrlReport = JSON.parse(output.stdout);
    for (const run of report.runs) assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))].sort(), route === 'contents' ? ['font-family', 'font-size', 'text-contrast'] : []);
    await writeFile(join(directory, `${route}.json`), JSON.stringify(report, null, 2));
  }
}));

test('copy checks prose beside excluded code and keeps visible text boundaries', async () => fixture(async (origin, cli) => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const route of ['mixed', 'code', 'prose', 'split', 'blocks', 'excluded', 'hidden']) {
      const expected = ['mixed', 'prose', 'split', 'blocks'].includes(route) ? ['copy'] : [];
      const output = await cli(route);
      assert.equal(output.code, expected.length ? 1 : 0, `${route}: ${output.stderr}`);
      const report: UrlReport = JSON.parse(output.stdout);
      for (const run of report.runs) assert.deepEqual([...new Set(run.states[0].findings.map(f => f.rule))], expected, route);
      await page.goto(`${origin}/${route}`);
      assert.deepEqual([...new Set((await checkPage(page)).findings.map(f => f.rule))], expected, route);
      await writeFile(join(directory, `${route}.json`), JSON.stringify(report, null, 2));
    }
  } finally { await browser.close(); }
}));

test('CLI and URL API reject supplied invalid plans and execute valid plans', async () => fixture(async (origin, cli) => {
  const receipts: ((CliResult & {name: string}) | {plan: Partial<InteractionPlan>; code: number | null; report: UrlReport})[] = [];
  for (const [name, plan] of [['null', null], ['false', false], ['zero', 0], ['empty-string', ''], ['array', []]] as const) {
    const path = join(directory, `${name}-plan.json`);
    await writeFile(path, JSON.stringify(plan));
    const output = await cli('button', ['--interactions', path]);
    assert.equal(output.code, 2, name);
    assert.equal(output.stdout, '');
    assert.match(output.stderr, /Interaction plan must be an object/);
    // @ts-expect-error Test runtime rejection of invalid external input.
    await assert.rejects(checkUrl(`${origin}/button`, {}, { interactions: plan }), /Interaction plan must be an object/);
    receipts.push({ name, ...output });
  }
  for (const plan of [{}, { buttons: [{ selector: '#save', key: 'Enter' as const, outcome: '#status', expectedText: 'Saved' }] }]) {
    const path = join(directory, 'valid-plan.json');
    await writeFile(path, JSON.stringify(plan));
    const output = await cli('button', ['--interactions', path]);
    assert.equal(output.code, 0, output.stderr);
    const report: UrlReport = JSON.parse(output.stdout);
    assert.deepEqual(report.findings, []);
    for (const run of report.runs) assert.deepEqual(run.states.map(state => state.name), plan.buttons ? ['initial', 'buttons[0]: Enter'] : ['initial']);
    receipts.push({ plan, code: output.code, report });
  }
  await writeFile(join(directory, 'interactions.json'), JSON.stringify(receipts, null, 2));
}));

test('CLI and page API check child gaps in boxless stacks and keep hidden groups excluded', async () => fixture(async (origin, cli) => {
  const policy: Policy = { ...defaultPolicy, colorSchemes: ['light', 'dark'] as ('light' | 'dark')[] };
  const config = join(directory, 'stack-policy.json');
  await writeFile(config, JSON.stringify(policy));
  const browser = await chromium.launch();
  try {
    for (const route of ['stack-normal-4', 'stack-contents-4', 'stack-zero-4', 'stack-normal-8', 'stack-contents-8', 'stack-zero-8', 'stack-hidden']) {
      const rules = route.endsWith('-4') ? ['layout-gap'] : [];
      const output = await cli(route, ['--config', config]);
      assert.equal(output.code, rules.length ? 1 : 0, `${route}: ${output.stderr}`);
      const report: UrlReport = JSON.parse(output.stdout);
      assert.equal(report.runs.length, 4);
      for (const viewport of policy.viewports) for (const colorScheme of policy.colorSchemes) {
        const page = await browser.newPage({ viewport, colorScheme });
        await page.goto(`${origin}/${route}`);
        const result = await checkPage(page, policy);
        assert.deepEqual(result.findings.map(f => f.rule), rules, route);
        if (rules.length) assert.equal(result.findings[0].actual, '4px');
        await page.close();
      }
      for (const run of report.runs) assert.deepEqual(run.states[0].findings.map(f => f.rule), rules);
      await writeFile(join(directory, `${route}.json`), JSON.stringify(report, null, 2));
    }
  } finally { await browser.close(); }
}));

test('copy checks native button labels and leaves hidden labels and editable values excluded', async () => fixture(async (origin, cli) => {
  for (const route of ['copy-button', 'copy-submit', 'copy-reset', 'copy-button-corrected', 'copy-submit-corrected', 'copy-reset-corrected', 'copy-editable', 'copy-hidden']) {
    const rules = ['copy-button', 'copy-submit', 'copy-reset'].includes(route) ? ['copy'] : [];
    const output = await cli(route);
    assert.equal(output.code, rules.length ? 1 : 0, `${route}: ${output.stderr}`);
    const report: UrlReport = JSON.parse(output.stdout);
    for (const run of report.runs) assert.deepEqual(run.states[0].findings.map(f => f.rule), rules, route);
    await writeFile(join(directory, `${route}.json`), JSON.stringify(report, null, 2));
  }
}));

test('named states wait for boxless visible content and reject text that stays hidden', async () => fixture(async (origin, cli) => {
  const policy: Policy = { ...defaultPolicy, colorSchemes: ['light', 'dark'] as ('light' | 'dark')[] };
  const config = join(directory, 'ready-policy.json');
  await writeFile(config, JSON.stringify(policy));
  const browser = await chromium.launch();
  try {
    for (const mode of ['normal', 'contents', 'zero']) for (const withText of [false, true]) {
      const plan: Partial<InteractionPlan> = { timeout: 5000, states: [{ name: 'Saved', action: 'press', key: 'Enter', selector: '#save', ready: { selector: '#status', ...(withText ? { expectedText: 'Saved' } : {}) } }] };
      const path = join(directory, 'ready-plan.json');
      await writeFile(path, JSON.stringify(plan));
      const output = await cli(`ready-${mode}`, ['--config', config, '--interactions', path]);
      assert.equal(output.code, 0, output.stderr);
      const report: UrlReport = JSON.parse(output.stdout);
      assert.deepEqual(report.findings, []);
      assert.ok(report.runs.every(run => run.states.length === 2 && run.states[1].name === 'Saved'));
      for (const viewport of policy.viewports) for (const colorScheme of policy.colorSchemes) {
        const page = await browser.newPage({ viewport, colorScheme });
        await page.goto(`${origin}/ready-${mode}`);
        assert.deepEqual((await checkInteractions(page, plan, policy)).findings, []);
        if (withText) assert.equal(await page.locator('#text').textContent(), 'Saved');
        await page.close();
      }
      await writeFile(join(directory, `ready-${mode}-${withText}.json`), JSON.stringify(report, null, 2));
    }
    const page = await browser.newPage();
    for (const attr of ['hidden', 'inert', 'style="opacity:0"', 'style="visibility:hidden"']) {
      await page.setContent(shell(`<button id="save" onclick="document.querySelector('#text').textContent='Saved'">Save</button><div id="status" ${attr}><span id="text">Pending</span></div>`));
      await assert.rejects(checkInteractions(page, { timeout: 1000, states: [{ name: 'Saved', action: 'press', key: 'Enter', selector: '#save', ready: { selector: '#status', expectedText: 'Saved' } }] }, policy), /Ready text did not match/);
    }
  } finally { await browser.close(); }
}));
