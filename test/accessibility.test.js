import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { checkPage, checkInteractions, validatePolicy } from '../src/index.js';
import { validateInteractions } from '../src/interactions.js';
import { createDemoServer } from '../demo/server.js';

const shell = content => `<html lang="en"><style>
html { background: white; color: black; font: 16px system-ui; }
body { margin: 24px; } button, input, select { font: inherit; min-height: 32px; margin: 8px; }
button:focus-visible { outline: 3px solid blue; outline-offset: 2px; }
.sr { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
</style><body>${content}</body></html>`;
const withPage = async callback => {
  const browser = await chromium.launch();
  try { await callback(await browser.newPage({ viewport: { width: 1200, height: 900 } })); }
  finally { await browser.close(); }
};
const has = (result, rule, part) => result.findings.some(f => f.rule === rule && (!part || f.selector.includes(part)));

test('page checks names, labels, references, matching text, state, and hidden scope', async () => withPage(async page => {
  await page.setContent(shell(`
    <button id="empty"></button><a href="#target"><svg width="24" height="24"></svg></a>
    <input type="image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3C/svg%3E">
    <input id="search" placeholder="Search"><button aria-label="Submit">Save</button>
    <button aria-labelledby="missing">Details</button><button aria-describedby="gone">Help</button>
    <button data-ui-disclosure aria-controls="panel" aria-expanded="true">Expand</button><div id="panel" hidden>Panel</div>
    <button aria-haspopup="menu">Menu</button><div role="combobox" aria-label="Choose"></div>
    <button data-ui-disclosure aria-expanded="false">Show details</button>
    <div hidden><button></button><input></div><div inert><button></button><input></div>
  `));
  const report = await checkPage(page);
  for (const rule of ['accessible-name', 'form-label', 'aria-reference', 'label-consistency', 'control-state', 'icon-button-tooltip']) assert.ok(has(report, rule), `Missing ${rule}: ${JSON.stringify(report.findings)}`);
  assert.equal(report.findings.filter(f => f.rule === 'form-label').length, 1);
  assert.equal(report.findings.filter(f => f.rule === 'aria-reference').length, 2);
  assert.ok(report.findings.some(f => f.rule === 'control-state' && f.actual === 'no controlled panel'));
  assert.ok(report.accessibilityCoverage.interactionRules.includes('not tested'));
  assert.ok(report.findings.filter(f => f.category === 'accessibility').every(f => f.status && f.selector && f.actual && f.expected && f.fix));
  assert.equal(report.findings.find(f => f.rule === 'icon-button-tooltip').category, 'design');
}));

test('valid labels and tooltips pass; a lazy popup reference needs state review', async () => withPage(async page => {
  await page.setContent(shell(`
    <button aria-label="Delete message" aria-describedby="tip"><svg width="24" height="24"></svg></button>
    <div id="tip" role="tooltip" hidden>Delete message</div>
    <button aria-describedby="tip"><span class="sr">Delete message</span><svg width="24" height="24"></svg></button>
    <button aria-label="Add food" aria-describedby="tip">+</button>
    <button disabled aria-label="Delete message"><svg width="24" height="24"></svg></button>
    <label for="search">Search foods</label><input id="search" placeholder="Apple">
    <input aria-label="Servings"><span id="name">Food category</span><select aria-labelledby="name"><option>Fruit</option></select>
    <button aria-haspopup="menu" aria-expanded="false" aria-controls="lazy-menu">Menu</button>
    <button data-ui-disclosure aria-controls="panel" aria-expanded="false">Show details</button><div id="panel" hidden>Details</div>
  `));
  const report = await checkPage(page);
  assert.deepEqual(report.findings.filter(f => f.category && f.status === 'failed'), []);
  assert.ok(report.findings.some(f => f.rule === 'control-state' && f.status === 'unresolved' && f.actual.includes('lazy-menu')));
  await page.locator('button').first().evaluate(el => el.removeAttribute('aria-describedby'));
  const excepted = await checkPage(page, { exceptions: [{ selector: 'button:first-of-type', rules: ['icon-button-tooltip'], reason: 'Test exception.' }] });
  assert.ok(!has(excepted, 'icon-button-tooltip'));
  assert.ok(excepted.suppressed.some(f => f.rule === 'icon-button-tooltip'));
}));

test('target-size uses the spacing exception instead of a blanket 24px minimum', async () => withPage(async page => {
  await page.setContent(shell(`<style>.small { min-height: 0; margin: 0; padding: 0; border: 0; width: 20px; height: 20px; } .joined { display: flex; } .apart { display: flex; gap: 24px; margin-top: 32px; }</style>
    <div class="joined"><button class="small">A</button><button class="small">B</button></div>
    <div class="apart"><button class="small">C</button><button class="small">D</button></div>`));
  const report = await checkPage(page);
  const failures = report.findings.filter(f => f.rule === 'target-size');
  assert.ok(failures.length > 0, JSON.stringify(report.findings));
  assert.ok(failures.every(f => f.selector.includes('div:nth-of-type(1)')), JSON.stringify(failures));
}));

test('open modal page check detects focus outside the modal', async () => withPage(async page => {
  await page.setContent(shell('<button>Outside</button><div role="dialog" aria-modal="true" aria-label="Edit food"><button>Cancel</button></div>'));
  assert.ok(has(await checkPage(page), 'dialog-focus'));
  await page.getByRole('button', { name: 'Cancel' }).focus();
  assert.ok(!has(await checkPage(page), 'dialog-focus'));
}));

test('interaction plans reject unknown fields, unsupported keys, and ambiguous selectors', async () => withPage(async page => {
  for (const plan of [null, [], { typo: [] }, { focus: 'button' }, { timeout: 0 }, { maxTabStops: 501 }, { buttons: [{ selector: 'button', key: 'Escape', outcome: '#result', expectedText: 'Done' }] }, { dialogs: [{ open: '#open', dialog: '#dialog' }] }]) assert.throws(() => validateInteractions(plan));
  assert.throws(() => validatePolicy({ exceptions: [{ selector: 'button', rules: ['unknown-accessibility'], reason: 'Test' }] }));
  await page.setContent(shell('<button>A</button><button>B</button>'));
  await assert.rejects(checkInteractions(page, { focus: [{ selector: 'button' }] }), /one element/);
  await assert.rejects(checkInteractions(page, { focus: [{ selector: '[' }] }));
}));

test('keyboard activation checks Enter and Space against a declared result', async () => withPage(async page => {
  await page.setContent(shell(`<button id="enter" onclick="document.querySelector('#one').textContent='Saved'">Save one</button><p id="one">Ready</p>
    <button id="space" onclick="document.querySelector('#two').textContent='Saved'">Save two</button><p id="two">Ready</p>
    <div role="button" tabindex="0" id="broken" onclick="document.querySelector('#three').textContent='Saved'">Save three</div><p id="three">Ready</p>`));
  const good = await checkInteractions(page, { buttons: [
    { selector: '#enter', key: 'Enter', outcome: '#one', expectedText: 'Saved' },
    { selector: '#space', key: 'Space', outcome: '#two', expectedText: 'Saved' },
  ] });
  assert.deepEqual(good.findings, []);
  const bad = await checkInteractions(page, { timeout: 100, buttons: [{ selector: '#broken', key: 'Enter', outcome: '#three', expectedText: 'Saved' }] });
  assert.ok(has(bad, 'keyboard-operation'));
  await assert.rejects(checkInteractions(page, { buttons: [{ selector: '#enter', key: 'Enter', outcome: '#one', expectedText: 'Saved' }] }), /already matches/);
}));

test('tooltip checks hover, real keyboard focus, Escape, and a hover-only defect', async () => withPage(async page => {
  await page.setContent(shell(`<button id="good" aria-label="Delete" aria-describedby="good-tip">Delete</button><div id="good-tip" role="tooltip" hidden>Delete message</div>
    <button id="bad" aria-label="More" aria-describedby="bad-tip">More</button><div id="bad-tip" role="tooltip" hidden>More actions</div>
    <script>for (const id of ['good','bad']) { const button=document.getElementById(id), tip=document.getElementById(id+'-tip');
    button.addEventListener('mouseenter',()=>tip.hidden=false); button.addEventListener('mouseleave',()=>tip.hidden=true);
    button.addEventListener('blur',()=>tip.hidden=true); button.addEventListener('keydown',e=>{if(e.key==='Escape')tip.hidden=true});
    if(id==='good')button.addEventListener('focus',()=>tip.hidden=false); }</script>`));
  const good = await checkInteractions(page, { tooltips: [{ trigger: '#good', tooltip: '#good-tip' }] });
  assert.deepEqual(good.findings, [], JSON.stringify(good.findings));
  assert.ok(good.checks.some(x => x.phase === 'escape' && x.status === 'passed'));
  const bad = await checkInteractions(page, { timeout: 100, tooltips: [{ trigger: '#bad', tooltip: '#bad-tip' }] });
  assert.ok(bad.findings.some(x => x.rule === 'icon-button-tooltip' && x.phase === 'focus'));
}));

test('focus checks detect missing styles, covered controls, and unreachable controls', async () => withPage(async page => {
  await page.setContent(shell(`<style>#plain:focus-visible { outline: none; } #covered { position: fixed; left: 500px; top: 200px; width: 120px; height: 40px; margin: 0; } #cover { position: fixed; left: 490px; top: 190px; width: 140px; height: 60px; background: black; z-index: 10; }</style>
    <button id="good">Save</button><button id="plain">Cancel</button><button id="covered">Covered</button><div id="cover"></div><button tabindex="-1" id="unreachable">Lost</button>`));
  const result = await checkInteractions(page, { maxTabStops: 10, focus: [{ selector: '#good' }, { selector: '#plain' }, { selector: '#covered' }, { selector: '#unreachable' }] });
  assert.ok(!result.findings.some(f => f.selector === '#good'), JSON.stringify(result.findings));
  assert.ok(result.findings.some(f => f.rule === 'focus-visible' && f.selector === '#plain' && f.status === 'unresolved'));
  assert.ok(result.findings.some(f => f.rule === 'focus-obscured' && f.selector === '#covered' && f.status === 'failed'));
  assert.ok(result.findings.some(f => f.rule === 'keyboard-operation' && f.selector === '#unreachable'));
}));

test('dialog checks entry, both tab directions, close, Escape, and focus return', async () => withPage(async page => {
  await page.setContent(shell(`<button id="open" onclick="document.querySelector('#modal').showModal()">Edit</button>
    <dialog id="modal" aria-label="Edit food"><button id="cancel" onclick="document.querySelector('#modal').close()">Cancel</button><input aria-label="Food name"></dialog>`));
  const result = await checkInteractions(page, { dialogs: [{ open: '#open', dialog: '#modal', close: '#cancel' }] });
  assert.deepEqual(result.findings, [], JSON.stringify(result.findings));
  for (const phase of ['entry', 'Tab', 'Shift+Tab', 'close-button', 'return-button', 'close-Escape', 'return-Escape']) assert.ok(result.checks.some(x => x.phase === phase && x.status === 'passed'), phase);
  await page.setContent(shell(`<button id="open" onclick="document.querySelector('#modal').hidden=false">Edit</button>
    <div id="modal" role="dialog" aria-label="Edit food" aria-modal="true" hidden><button id="cancel" onclick="document.querySelector('#modal').hidden=true;this.blur()">Cancel</button></div>`));
  const bad = await checkInteractions(page, { timeout: 100, maxTabStops: 10, dialogs: [{ open: '#open', dialog: '#modal', close: '#cancel' }] });
  assert.ok(bad.findings.some(x => x.phase === 'entry'));
  assert.ok(bad.findings.some(x => x.phase === 'Tab'));
  assert.ok(bad.findings.some(x => x.phase === 'return-button'));
  assert.ok(bad.findings.some(x => x.phase === 'close-Escape'));
}));

test('CLI runs explicit interaction plans and leaves actions untouched without a plan', async () => {
  let actions = 0;
  const server = createServer((request, response) => {
    if (request.url === '/action') { actions++; return response.end('Done'); }
    response.setHeader('Content-Type', 'text/html');
    response.end(shell(`<button id="save" onclick="document.querySelector('#status').textContent='Saved';fetch('/action')">Save</button><p id="status">Ready</p>`));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const cli = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/lintapple.js', url, '--json', ...args]);
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data);
    child.stderr.on('data', data => stderr += data);
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
  try {
    const plain = await cli([]);
    assert.equal(plain.code, 0, plain.stderr);
    assert.equal(actions, 0);
    assert.ok(JSON.parse(plain.stdout).runs.every(run => run.accessibilityCoverage.interactionRules.includes('not tested')));
    await mkdir('test-results', { recursive: true });
    const path = 'test-results/accessibility-interactions.json';
    await writeFile(path, JSON.stringify({ focus: [{ selector: '#save' }], buttons: [{ selector: '#save', key: 'Enter', outcome: '#status', expectedText: 'Saved' }] }));
    const checked = await cli(['--interactions', path]);
    assert.equal(checked.code, 0, checked.stderr || checked.stdout);
    const report = JSON.parse(checked.stdout);
    assert.equal(actions, 2);
    assert.ok(report.runs.every(run => run.accessibilityCoverage.interactions.length > 0));
    await writeFile(path, JSON.stringify({ timeout: 100, buttons: [{ selector: '#save', key: 'Enter', outcome: '#status', expectedText: 'Wrong' }] }));
    const failed = await cli(['--interactions', path]);
    assert.equal(failed.code, 1, failed.stderr);
    assert.ok(JSON.parse(failed.stdout).findings.some(f => f.rule === 'keyboard-operation'));
    await writeFile(path, JSON.stringify({ buttons: [{ selector: '#save', key: 'Escape' }] }));
    const invalid = await cli(['--interactions', path]);
    assert.equal(invalid.code, 2);
    await writeFile('test-results/accessibility-cli-report.json', JSON.stringify(report, null, 2));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('demo tooltips work on hover, keyboard focus, and Escape in both themes', async () => {
  const server = createDemoServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await withPage(async page => {
      for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${origin}/demo/specimen.html?rule=control-size&state=after&theme=${theme}`);
        await page.locator('[data-ready="true"]').waitFor();
        const specimen = await checkInteractions(page, { tooltips: [{ trigger: '.remove-button', tooltip: '#remove-tooltip' }] });
        assert.deepEqual(specimen.findings, [], JSON.stringify(specimen.findings));
        assert.deepEqual((await checkPage(page)).findings, []);
        await page.goto(`${origin}/demo/`);
        await page.getByText('Loading check results', { exact: true }).first().waitFor({ state: 'hidden' });
        if (theme === 'light') await page.locator('#theme-toggle').click();
        const index = await checkInteractions(page, { maxTabStops: 500, tooltips: [{ trigger: '#theme-toggle', tooltip: '#theme-tooltip' }, { trigger: '[data-copy]', tooltip: '#copy-tooltip' }] });
        assert.deepEqual(index.findings, [], JSON.stringify(index.findings));
        await page.locator('main').getByRole('link', { name: 'Larger controls', exact: true }).click();
        await page.getByRole('link', { name: '← Index', exact: true }).click();
        const ids = await page.locator('[id]').evaluateAll(elements => elements.map(el => el.id));
        assert.equal(new Set(ids).size, ids.length, 'Tooltip portals must not leave duplicate IDs after navigation.');
      }
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
