import { assertProcessError } from './assert-process-error.js';
import type { AddressInfo } from 'node:net';
import type { UrlReport, NamedState } from '../src/types.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
const { checkPage, checkInteractions, checkUrl } = await import(process.env.LINTAPPLE_PACKAGE || '../src/index.js') as typeof import('../src/index.js');
import { validateInteractions } from '../src/interactions.js';

const execute = promisify(execFile);
const states: NamedState[] = [
  { name: 'Menu open', action: 'click', selector: '#menu-toggle', ready: { selector: '#menu' } },
  { name: 'Menu closed', action: 'press', selector: '#menu-toggle', key: 'Escape', ready: { selector: '#menu', state: 'hidden' } },
  { name: 'Dialog open', action: 'click', selector: '#edit', ready: { selector: '#editor' } },
  { name: 'Form error', action: 'click', selector: '#save', ready: { selector: '#error', expectedText: 'Enter a project name.' } },
  { name: 'Form filled', action: 'fill', selector: '#project-name', value: 'Research', ready: { selector: '#error', state: 'hidden' } },
  { name: 'Saved result', action: 'click', selector: '#save', ready: { selector: '#saved', expectedText: 'Saved Research' } },
];
const html = (broken: boolean) => `<!doctype html><html lang="en"><head><title>Project editor</title><style>
html { background: white; color: #202020; font: 16px/24px system-ui; }
body { margin: 24px; } p { margin: 0; } h1 { font-size: 24px; } h2 { font-size: 20px; }
button, input { font: 14px/20px system-ui; min-height: 40px; padding: 8px; color: #202020; background: white; }
.ui-stack { display: flex; flex-direction: column; gap: 8px; } [hidden] { display: none; }
.actions { display: flex; gap: 8px; padding: 8px; } dialog { max-width: calc(100vw - 64px); padding: 16px; }
${broken ? '#menu, #dialog-text, #error, #saved { font-size: 17px; }' : ''}
</style></head><body><main class="ui-stack" data-ui-stack>
<h1>Projects</h1><div class="actions" data-ui-actions data-ui-container>
<button id="menu-toggle" data-ui-disclosure aria-controls="menu" aria-expanded="false">Options</button>
<button id="edit">Edit project</button></div><p id="menu" hidden>Project options</p><p id="saved" hidden></p>
</main><dialog id="editor" aria-label="Edit project"><form class="ui-stack" data-ui-stack novalidate>
<h2>Edit project</h2><p id="dialog-text">Enter the project name.</p>
<label for="project-name">Project name</label><input id="project-name" aria-describedby="error">
<p id="error" hidden>Enter a project name.</p><div class="actions" data-ui-actions data-ui-container>
<button id="cancel" type="button">Cancel</button><button id="save" type="submit">Save</button></div>
</form></dialog><script>
const menu=document.querySelector('#menu'), toggle=document.querySelector('#menu-toggle'), editor=document.querySelector('#editor');
const name=document.querySelector('#project-name'), error=document.querySelector('#error'), saved=document.querySelector('#saved');
toggle.onclick=()=>{menu.hidden=!menu.hidden;toggle.setAttribute('aria-expanded',String(!menu.hidden));};
toggle.onkeydown=e=>{if(e.key==='Escape'){menu.hidden=true;toggle.setAttribute('aria-expanded','false');}};
document.querySelector('#edit').onclick=()=>editor.showModal();
document.querySelector('#cancel').onclick=()=>editor.close();
name.oninput=()=>{error.hidden=true;name.removeAttribute('aria-invalid');};
document.querySelector('form').onsubmit=async e=>{e.preventDefault();if(!name.value.trim()){error.hidden=false;name.setAttribute('aria-invalid','true');return;}
const response=await fetch('/save',{method:'POST',body:name.value});if(!response.ok)return;
saved.textContent='Saved '+await response.text();saved.hidden=false;editor.close();};
</script></body></html>`;

async function fixture(callback: (origin: string, saved: string[]) => Promise<void>) {
  const saved: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/save') {
      let value = ''; for await (const part of request as AsyncIterable<Buffer>) value += part;
      saved.push(value); response.end(value); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(html(request.url === '/broken'));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await callback(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, saved); }
  finally { await new Promise<void>((resolve, reject: (reason?: unknown) => void) => server.close(error => error ? reject(error) : resolve())); }
}

test('named actions check menu, dialog, form error, and server-saved states', async () => fixture(async (origin, saved) => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`${origin}/broken`);
    assert.deepEqual((await checkPage(page)).findings, [], 'The initial page must pass.');
    const report = await checkInteractions(page, { states });
    assert.deepEqual(report.states.map(state => state.name), states.map(state => state.name));
    for (const name of ['Menu open', 'Dialog open', 'Form error', 'Saved result']) {
      assert.ok(report.findings.some(f => f.state === name && f.rule === 'font-size'), `No finding for ${name}.`);
    }
    assert.deepEqual(report.states.find(state => state.name === 'Menu closed')!.findings, []);
    assert.deepEqual(saved, ['Research']);
    await page.goto(origin);
    const good = await checkInteractions(page, { states });
    assert.deepEqual(good.findings, []);
    assert.ok(good.states.every(state => state.elements > 0));
    const excepted = await checkUrl(`${origin}/broken`, { exceptions: [{ selector: '#menu', rules: ['font-size'], reason: 'Menu test exception.' }] }, { interactions: { states } });
    assert.ok(!excepted.findings.some(f => f.state === 'Menu open'));
    assert.ok(excepted.runs.every(run => run.states.find(state => state.name === 'Menu open')!.suppressed.length === 1));
    assert.ok(excepted.runs.every(run => run.suppressed.some(f => f.state === 'Menu open')));
  } finally { await browser.close(); }
}));

test('named states validate data and fail when a state is missing or ambiguous', async () => fixture(async origin => {
  for (const plan of [
    { states: null }, { states: Array.from({ length: 101 }, () => states[0]) },
    { states: [{ ...states[0], name: '' }] }, { states: [states[0], states[0]] },
    { states: [{ ...states[0], action: 'evaluate' }] }, { states: [{ ...states[0], ready: null }] },
    { states: [{ ...states[0], ready: { selector: '#menu', state: 'attached' } }] },
    { states: [{ ...states[0], ready: { selector: '#menu', typo: true } }] },
    { states: [{ ...states[0], value: 'unused' }] },
    { states: [{ ...states[0], action: 'fill' }] },
    { states: [{ ...states[0], action: 'press', key: '' }] },
    { states: [{ ...states[0], name: 'initial' }] },
  ]) assert.throws(() => validateInteractions(plan));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(origin);
    await assert.rejects(checkInteractions(page, { states }, {}, { timeout: 0 }), /positive integer/);
    assert.equal(await page.locator('#menu').isVisible(), false);
    const hover = await checkInteractions(page, { states: [{ name: 'Options hovered', action: 'hover', selector: '#menu-toggle', ready: { selector: '#menu-toggle' } }] });
    assert.deepEqual(hover.findings, []);
    assert.equal(hover.states[0].name, 'Options hovered');
    await page.locator('#menu-toggle').evaluate(el => el.addEventListener('keydown', event => {
      if ((event as KeyboardEvent).key === 'Escape') document.querySelector<HTMLElement>('#menu')!.remove();
    }));
    const removed = await checkInteractions(page, { states: states.slice(0, 2) });
    assert.deepEqual(removed.findings, []);
    assert.equal(await page.locator('#menu').count(), 0);
    for (const [step, message] of [
      [{ ...states[0], selector: 'button' }, /one element/],
      [{ ...states[0], ready: { selector: 'button' } }, /at most one element/],
      [{ ...states[0], ready: { selector: '#absent' } }, /Timeout/],
      [{ ...states[0], ready: { selector: '#menu', expectedText: 'Never ready' } }, /Ready text did not match/],
      [{ ...states[0], selector: '[' }, /not a valid selector/],
    ] as [NamedState, RegExp][]) {
      await page.goto(origin);
      await assert.rejects(checkInteractions(page, { timeout: 1000, states: [step] }), error => error instanceof Error && /Menu open/.test(error.message) && message.test(error.message));
    }
  } finally { await browser.close(); }
}));

test('existing button and dialog plans also check the page after their actions', async () => fixture(async origin => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/broken`);
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('#menu')!.textContent = '';
      document.querySelector('#menu-toggle')!.addEventListener('click', () => document.querySelector<HTMLElement>('#menu')!.textContent = 'Project options');
    });
    const button = await checkInteractions(page, { buttons: [{ selector: '#menu-toggle', key: 'Enter', outcome: '#menu', expectedText: 'Project options' }] });
    assert.ok(button.findings.some(f => f.rule === 'font-size' && f.state === 'buttons[0]: Enter'));
    await page.goto(`${origin}/broken`);
    const dialog = await checkInteractions(page, { dialogs: [{ open: '#edit', dialog: '#editor', close: '#cancel' }] });
    assert.ok(dialog.findings.some(f => f.rule === 'font-size' && f.state === 'dialogs[0]: open for button'));
    assert.ok(dialog.findings.some(f => f.rule === 'font-size' && f.state === 'dialogs[0]: open for Escape'));
    assert.ok(dialog.states.filter(s => s.name.includes('close with')).every(s => s.findings.length === 0));
  } finally { await browser.close(); }
}));

test('CLI checks every named state and preserves pass, finding, and execution-error exits', async () => fixture(async origin => {
  await mkdir('test-results', { recursive: true });
  const path = 'test-results/page-states-plan.json';
  await writeFile(path, JSON.stringify({ states }));
  const cli = async (route: string, args = ['--json']) => {
    try { return { code: 0, ...await execute(process.execPath, [process.env.LINTAPPLE_CLI || 'dist/bin/lintapple.js', `${origin}/${route}`, '--interactions', path, ...args]) }; }
    catch (error) { assertProcessError(error); if (typeof error.code !== 'number') throw error; return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
  };
  const plain = await execute(process.execPath, [process.env.LINTAPPLE_CLI || 'dist/bin/lintapple.js', `${origin}/broken`, '--json']);
  assert.deepEqual(JSON.parse(plain.stdout).findings, []);
  const good = await cli(''); assert.equal(good.code, 0, good.stderr);
  const bad = await cli('broken'); assert.equal(bad.code, 1, bad.stderr);
  const report: UrlReport = JSON.parse(bad.stdout);
  assert.ok(report.runs.every(run => run.states.length === states.length + 1));
  assert.ok(report.findings.every(f => f.state && f.viewport && f.colorScheme && f.selector && f.actual && f.expected && f.fix));
  const text = await cli('broken', []); assert.equal(text.code, 1); assert.match(text.stdout, /Saved result/);
  await writeFile('test-results/page-states-cli-report.json', JSON.stringify(report, null, 2));
  await writeFile(path, JSON.stringify({ timeout: 100, states: [{ ...states[0], ready: { selector: '#absent' } }] }));
  const missing = await cli(''); assert.equal(missing.code, 2); assert.match(missing.stderr, /Menu open/);
}));
