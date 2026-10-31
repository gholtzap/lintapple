import type { Page } from 'playwright';
import type { AddressInfo } from 'node:net';
import type { UrlReport, InteractionReport, Key, CheckedState } from '../src/types.js';
import type { CliResult } from './types.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const { checkInteractions } = await import(process.env.LINTAPPLE_PACKAGE || '../src/index.js') as typeof import('../src/index.js');
import { validateInteractions } from '../src/interactions.js';

const shell = (content: string) => `<html lang="en"><style>html{background:white;color:black;font:16px system-ui}button{font:inherit;min-height:32px;margin:8px;padding:0 8px}button:focus-visible{outline:3px solid blue}</style><body>${content}</body></html>`;
const tabs = ({ manual = false, vertical = false, descendant = false, fault = '' } = {}) => shell(`
<div id="tabs" role="tablist" aria-label="Case views" ${vertical ? 'aria-orientation="vertical"' : ''} ${descendant ? 'tabindex="0" aria-activedescendant="t1"' : ''}>
${[1, 2, 3].map(i => `<button id="t${i}" role="tab" aria-selected="${i === 1}" aria-controls="p${i}" tabindex="${!descendant && i === 1 ? 0 : -1}">View ${i}</button>`).join('')}</div>
${[1, 2, 3].map(i => `<section id="p${i}" role="tabpanel" aria-labelledby="t${i}" tabindex="0" ${i !== 1 ? 'hidden' : ''}>Panel ${i}</section>`).join('')}
<button id="after">Next</button><script>(()=>{
const root=document.querySelector('#tabs'),items=[...root.querySelectorAll('[role=tab]')];let index=0;
function select(i){if('${fault}'==='selection')return;items.forEach((el,n)=>{el.setAttribute('aria-selected',String(n===i));if('${fault}'!=='panel')document.querySelector('#p'+(n+1)).hidden=n!==i})}
function focus(i){index=i;if(${descendant})root.setAttribute('aria-activedescendant',items[i].id);else{items.forEach((el,n)=>el.tabIndex=n===i?0:-1);items[i].focus()}if(!${manual})select(i)}
root.addEventListener('keydown',e=>{if('${fault}'==='keys')return;const next='${vertical ? 'ArrowDown' : 'ArrowRight'}',prev='${vertical ? 'ArrowUp' : 'ArrowLeft'}';
if(e.key===next||e.key===prev){e.preventDefault();focus((index+(e.key===next?1:2))%3)}
else if(e.key==='Home'||e.key==='End'){e.preventDefault();focus(e.key==='Home'?0:2)}
else if(e.key==='Enter'||e.key===' '){e.preventDefault();select(index)}});
})();</script>`);
const menu = ({ descendant = false, horizontal = false, menubar = false, fault = '' } = {}) => shell(`
${menubar ? '' : '<button id="open" aria-haspopup="menu" aria-expanded="false" aria-controls="menu">Actions</button>'}
<div id="menu" role="${menubar ? 'menubar' : 'menu'}" aria-label="Case actions" ${horizontal ? 'aria-orientation="horizontal"' : ''} ${menubar ? '' : 'hidden'} ${descendant ? 'tabindex="-1" aria-activedescendant="m1"' : ''}>
<button id="m1" role="menuitemcheckbox" aria-checked="false" tabindex="${menubar && !descendant ? 0 : -1}">Show notes</button>
<div role="group" aria-label="View"><button id="m2" role="menuitemradio" aria-checked="true" tabindex="-1">List</button><button id="m3" role="menuitemradio" aria-checked="false" tabindex="-1">Grid</button></div>
<button id="m4" role="menuitem" aria-disabled="true" tabindex="-1">Unavailable</button>
<button id="m5" role="menuitem" tabindex="-1">Save</button></div><p id="status">Ready</p><button id="after">Next</button>
<script>(()=>{const root=document.querySelector('#menu'),opener=document.querySelector('#open')||document.querySelector('#after'),items=[...root.querySelectorAll('[role^=menuitem]')];let index=0;
function focus(i){index=i;if(${descendant}){root.focus();root.setAttribute('aria-activedescendant',items[i].id)}else items[i].focus()}
function close(){root.hidden=true;opener.setAttribute('aria-expanded','false');opener.focus()}
opener.addEventListener('keydown',e=>{if(['Enter',' ','ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();root.hidden=false;opener.setAttribute('aria-expanded','true');if('${fault}'!=='entry')focus(e.key==='ArrowUp'?4:0)}});
root.addEventListener('keydown',e=>{const next='${horizontal ? 'ArrowRight' : 'ArrowDown'}',prev='${horizontal ? 'ArrowLeft' : 'ArrowUp'}';
if(e.key===next||e.key===prev){e.preventDefault();if('${fault}'!=='keys')focus((index+(e.key===next?1:4))%5);if('${fault}'==='arrow-state')items[0].setAttribute('aria-checked','true')}
else if(e.key==='Home'||e.key==='End'){e.preventDefault();focus(e.key==='Home'?0:4)}
else if(e.key==='Escape'){e.preventDefault();close()}
else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(index===0&&'${fault}'!=='checked')items[0].setAttribute('aria-checked',String(items[0].getAttribute('aria-checked')!=='true'));
if(index===1||index===2){if('${fault}'!=='radio')items[1].setAttribute('aria-checked',String(index===1));items[2].setAttribute('aria-checked',String(index===2))}
if(index===4){if('${fault}'!=='action')document.querySelector('#status').textContent='Saved';close()}}});})();</script>`);
const withPage = async (callback: (page: Page) => Promise<void>) => {
  const browser = await chromium.launch();
  try { await callback(await browser.newPage()); } finally { await browser.close(); }
};
const tabStep = (key: Key, focus: string, selected = focus) => ({ key, focus, selected });
const menuStep = (key: Key, focus: string, checked?: CheckedState[]) => ({ key, focus, ...(checked ? { checked } : {}) });
const choice = (selector: string, value: boolean | 'mixed') => ({ selector, value });
const passed = (result: InteractionReport) => assert.deepEqual(result.findings, [], JSON.stringify(result.findings));

test('widget plans reject invalid shapes, unsupported keys, and incomplete state expectations', () => {
  const invalid = [
    { tabs: null }, { menus: {} }, { tabs: [{}] }, { tabs: [{ selector: '#tabs', steps: [] }] },
    { tabs: [{ selector: '#tabs', steps: [{ key: 'ArrowRight', focus: '#t2' }] }] },
    { menus: [{ selector: '#menu', openKey: 'Enter', steps: [menuStep('ArrowDown', '#m2')] }] },
    { menus: [{ selector: '#menu', open: '#open', openKey: 'Delete', steps: [menuStep('ArrowDown', '#m2')] }] },
    { menus: [{ selector: '#menu', steps: [{ key: 'Delete', focus: '#m2' }] }] },
    { menus: [{ selector: '#menu', steps: [{key: 'ArrowDown', focus: '#m2', checked: [{selector: '#m2', value: 'true'}]}] }] },
    { menus: [{ selector: '#menu', steps: [menuStep('ArrowDown', '#m2', [])] }] },
    { menus: [{ selector: '#menu', steps: [{ key: 'Enter', focus: '#m2', outcome: '#status' }] }] },
    { tabs: [{ selector: '#tabs', steps: Array.from({ length: 101 }, () => tabStep('ArrowRight', '#t2')) }] },
  ];
  for (const plan of invalid) assert.throws(() => validateInteractions(plan), JSON.stringify(plan));
});

test('tabs check both axes, wrapping, Home, End, manual activation, panels, and active descendants', async () => withPage(async page => {
  for (const manual of [false, true]) for (const vertical of [false, true]) for (const descendant of [false, true]) {
    await page.setContent(tabs({ manual, vertical, descendant }));
    const next = vertical ? 'ArrowDown' : 'ArrowRight', prev = vertical ? 'ArrowUp' : 'ArrowLeft';
    const steps: import('../src/types.js').TabStep[] = [];
    let selected = '#t1';
    for (const [key, focus] of [[prev, '#t3'], [next, '#t1'], [next, '#t2'], ['End', '#t3'], ['Home', '#t1'], [next, '#t2']] as [Key, string][]) {
      if (!manual) selected = focus;
      steps.push(tabStep(key, focus, selected));
      if (manual && focus !== selected) { steps.push(tabStep('Enter', focus)); selected = focus; }
    }
    steps.push(tabStep(prev, '#t1', manual ? selected : '#t1'));
    if (manual) steps.push(tabStep('Space', '#t1'));
    const result = await checkInteractions(page, { tabs: [{ selector: '#tabs', steps }] });
    passed(result);
    assert.ok(result.checks.some(check => check.phase?.includes('Arrow')));
  }
}));

test('tab failures report wrong focus, stale selection, wrong panels, and multiple selections', async () => withPage(async page => {
  for (const fault of ['keys', 'selection', 'panel']) {
    await page.setContent(tabs({ fault }));
    const result = await checkInteractions(page, { timeout: 80, tabs: [{ selector: '#tabs', steps: [tabStep('ArrowRight', '#t2')] }] });
    assert.ok(result.findings.some(f => f.rule === (fault === 'keys' ? 'keyboard-operation' : 'control-state')), fault);
  }
  await page.setContent(tabs());
  await page.locator('#t2').evaluate(el => el.setAttribute('aria-selected', 'true'));
  const result = await checkInteractions(page, { timeout: 80, tabs: [{ selector: '#tabs', steps: [tabStep('ArrowRight', '#t2')] }] });
  assert.ok(result.findings.some(f => f.phase === 'widget-baseline'));
}));

const menuSteps = (horizontal: boolean) => [
  menuStep(horizontal ? 'ArrowRight' : 'ArrowDown', '#m2'),
  menuStep(horizontal ? 'ArrowLeft' : 'ArrowUp', '#m1'),
  menuStep('Space', '#m1', [choice('#m1', true)]),
  menuStep(horizontal ? 'ArrowLeft' : 'ArrowUp', '#m5'),
  menuStep(horizontal ? 'ArrowRight' : 'ArrowDown', '#m1'),
  menuStep('End', '#m5'), menuStep('Home', '#m1'),
  menuStep(horizontal ? 'ArrowRight' : 'ArrowDown', '#m2'),
  menuStep(horizontal ? 'ArrowRight' : 'ArrowDown', '#m3'),
  menuStep('Enter', '#m3', [choice('#m2', false), choice('#m3', true)]),
  menuStep(horizontal ? 'ArrowRight' : 'ArrowDown', '#m4'),
  menuStep('Enter', '#m4'),
  menuStep('Escape', '#open'),
];
test('menus check opening keys, both axes, wrapping, checked states, disabled items, and Escape', async () => withPage(async page => {
  const cases = [
    ...[false, true].flatMap(descendant => [false, true].map(horizontal => ({ descendant, horizontal, openKey: 'Enter' }))),
    { descendant: false, horizontal: false, openKey: 'Space' },
    { descendant: false, horizontal: false, openKey: 'ArrowDown' },
    { descendant: true, horizontal: false, openKey: 'ArrowUp' },
  ];
  for (const { descendant, horizontal, openKey } of cases) {
    await page.setContent(menu({ descendant, horizontal }));
    const steps: import('../src/types.js').MenuStep[] = [...(openKey === 'ArrowUp' ? [menuStep('Home', '#m1')] : []), ...menuSteps(horizontal)];
    passed(await checkInteractions(page, { menus: [{ selector: '#menu', open: '#open', openKey: openKey as import('../src/types.js').Menu['openKey'], steps }] }));
    assert.equal(await page.locator('#menu').isVisible(), false);
  }
}));

test('menu failures report keyboard, entry, checked-state, radio-group, and action faults', async () => withPage(async page => {
  for (const fault of ['keys', 'entry', 'checked', 'radio', 'arrow-state', 'action']) {
    await page.setContent(menu({ fault }));
    const steps: import('../src/types.js').MenuStep[] = fault === 'action' ? [menuStep('End', '#m5'), { key: 'Enter', focus: '#open', outcome: '#status', expectedText: 'Saved' }] : fault === 'arrow-state' ? [menuStep('ArrowDown', '#m2')] : menuSteps(false);
    const result = await checkInteractions(page, { timeout: 1000, menus: [{ selector: '#menu', open: '#open', steps }] });
    assert.ok(result.findings.length, fault);
    assert.ok(result.findings.every(f => f.status === 'failed' && f.category === 'accessibility'), JSON.stringify(result));
  }
}));

test('menu plans require an activation witness and reject stale outcomes and ambiguous selectors', async () => withPage(async page => {
  await page.setContent(menu());
  await assert.rejects(checkInteractions(page, { menus: [{ selector: '#menu', open: '#open', steps: [menuStep('Enter', '#m1')] }] }), /expected checked state/);
  await page.setContent(menu());
  await assert.rejects(checkInteractions(page, { menus: [{ selector: '#menu', open: '#open', steps: [menuStep('End', '#m5'), menuStep('Enter', '#open')] }] }), /declared outcome/);
  await page.setContent(menu());
  await page.locator('#status').evaluate(el => el.textContent = 'Saved');
  await assert.rejects(checkInteractions(page, { menus: [{ selector: '#menu', open: '#open', steps: [menuStep('End', '#m5'), { key: 'Enter', focus: '#open', outcome: '#status', expectedText: 'Saved' }] }] }), /already matches/);
  await page.setContent(tabs());
  await assert.rejects(checkInteractions(page, { tabs: [{ selector: '#tabs', steps: [tabStep('ArrowRight', 'button')] }] }), /one element/);
  await assert.rejects(checkInteractions(page, { tabs: [{ selector: '#tabs', steps: [tabStep('ArrowRight', '[')] }] }));
}));

test('widget findings use the existing scoped exceptions and preserve app globals', async () => withPage(async page => {
  await page.setContent(tabs({ fault: 'selection' }));
  await page.evaluate(() => window.__lintappleWidgetState = 'App value');
  const result = await checkInteractions(page, { timeout: 80, tabs: [{ selector: '#tabs', steps: [tabStep('ArrowRight', '#t2')] }] }, { exceptions: [{ selector: '#tabs', rules: ['control-state'], reason: 'Recorded test case.' }] });
  passed(result);
  assert.ok(result.suppressed.some(f => f.rule === 'control-state'));
  assert.equal(await page.evaluate(() => window.__lintappleWidgetState), 'App value');
}));

test('CLI accepts widget plans, reports their coverage, and returns exit codes 0, 1, and 2', async () => {
  const server = createServer((request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(request.url?.startsWith('/menu') ? menu({ fault: request.url === '/menu-bad' ? 'checked' : '' }) : tabs({ fault: request.url === '/bad' ? 'selection' : '' })); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cli = (route: string, path: string) => new Promise<CliResult>((resolve, reject: (reason?: unknown) => void) => {
    const child = spawn(process.execPath, [process.env.LINTAPPLE_CLI || 'dist/bin/lintapple.js', origin + route, '--json', '--interactions', path]);
    let stdout = '', stderr = '';
    child.stdout.on('data', (data: Buffer) => stdout += data); child.stderr.on('data', (data: Buffer) => stderr += data);
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
  try {
    await mkdir('test-results', { recursive: true });
    const path = `test-results/widget-interactions-${process.pid}.json`;
    await writeFile(path, JSON.stringify({ tabs: [{ selector: '#tabs', steps: [tabStep('ArrowRight', '#t2'), tabStep('ArrowLeft', '#t1')] }] }));
    const good = await cli('/good', path);
    assert.equal(good.code, 0, good.stderr || good.stdout);
    const report: UrlReport = JSON.parse(good.stdout);
    assert.equal(report.runs.length, 2);
    assert.ok(report.runs.every(run => run.accessibilityCoverage.interactions!.some(check => check.phase === 'tabs-1-ArrowRight')));
    assert.ok(report.runs.every(run => run.states.some(state => state.name === 'tabs[0]: step 1 ArrowRight')));
    const bad = await cli('/bad', path);
    assert.equal(bad.code, 1, bad.stderr || bad.stdout);
    assert.ok((JSON.parse(bad.stdout) as UrlReport).findings.some(f => f.rule === 'control-state'));
    await writeFile(path, JSON.stringify({ menus: [{ selector: '#menu', open: '#open', steps: [menuStep('Space', '#m1', [choice('#m1', true)]), menuStep('Escape', '#open')] }] }));
    const menuGood = await cli('/menu', path);
    assert.equal(menuGood.code, 0, menuGood.stderr || menuGood.stdout);
    assert.ok((JSON.parse(menuGood.stdout) as UrlReport).runs.every(run => run.states.some(state => state.name === 'menus[0]: step 1 Space')));
    const menuBad = await cli('/menu-bad', path);
    assert.equal(menuBad.code, 1, menuBad.stderr || menuBad.stdout);
    await writeFile(path, JSON.stringify({ tabs: [{ selector: '#tabs', steps: [{ key: 'Delete', focus: '#t2' }] }] }));
    assert.equal((await cli('/good', path)).code, 2);
    await writeFile('test-results/widget-cli-report.json', JSON.stringify(report, null, 2));
  } finally { await new Promise<void>((resolve, reject: (reason?: unknown) => void) => server.close(error => error ? reject(error) : resolve())); }
});

test('tabs leave the tab list through Tab and Shift+Tab', async () => withPage(async page => {
  await page.setContent(tabs());
  passed(await checkInteractions(page, { tabs: [{ selector: '#tabs', steps: [tabStep('Tab', '#p1', '#t1'), tabStep('Shift+Tab', '#t1')] }] }));
  await page.setContent(tabs());
  await page.locator('#t2').evaluate(el => el.tabIndex = 0);
  const result = await checkInteractions(page, { timeout: 80, tabs: [{ selector: '#tabs', steps: [tabStep('Tab', '#p1', '#t1')] }] });
  assert.ok(result.findings.some(f => f.rule === 'keyboard-operation'));
}));

test('menubars use keyboard entry and declared boundary behavior', async () => withPage(async page => {
  await page.setContent(menu({ menubar: true, horizontal: true }));
  passed(await checkInteractions(page, { menus: [{ selector: '#menu', steps: [menuStep('ArrowRight', '#m2'), menuStep('ArrowLeft', '#m1')] }] }));
  await page.setContent(menu({ menubar: true, horizontal: true }).replace('focus((index+(e.key===next?1:4))%5)', 'focus(Math.max(0,Math.min(4,index+(e.key===next?1:-1))))'));
  passed(await checkInteractions(page, { menus: [{ selector: '#menu', steps: [menuStep('ArrowLeft', '#m1'), menuStep('End', '#m5'), menuStep('ArrowRight', '#m5'), menuStep('Home', '#m1')] }] }));
}));

test('nested menus verify child entry, radio groups, Escape return, and submenu states', async () => withPage(async page => {
  const fixture = shell(`<div id="bar" role="menubar" aria-label="Tools">
<button id="parent" role="menuitem" tabindex="0" aria-haspopup="menu" aria-expanded="false" aria-controls="child">Views</button>
<div id="child" role="menu" aria-label="Views" hidden>
<button id="c1" role="menuitemradio" aria-checked="true" tabindex="-1">List</button><button id="c2" role="menuitemradio" aria-checked="false" tabindex="-1">Grid</button>
<hr role="separator"><button id="c3" role="menuitemradio" aria-checked="true" tabindex="-1">Compact</button>
</div></div><button id="next">Next</button>
<script>(()=>{const parent=document.querySelector('#parent'),child=document.querySelector('#child');parent.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='Enter'){e.preventDefault();child.hidden=false;parent.setAttribute('aria-expanded','true');document.querySelector('#c1').focus()}});
child.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();document.querySelector('#c2').focus()}else if(e.key==='Enter'){e.preventDefault();document.querySelector('#c1').setAttribute('aria-checked','false');document.querySelector('#c2').setAttribute('aria-checked','true')}
else if(e.key==='Escape'){e.preventDefault();child.hidden=true;parent.setAttribute('aria-expanded','false');parent.focus()}})})();</script>`);
  for (const key of ['ArrowDown', 'Enter'] as const) {
    await page.setContent(fixture);
    passed(await checkInteractions(page, { menus: [{ selector: '#bar', steps: [menuStep(key, '#c1'), menuStep('ArrowDown', '#c2'), menuStep('Enter', '#c2', [choice('#c1', false), choice('#c2', true)]), menuStep('Escape', '#parent')] }] }));
  }
  await page.setContent(fixture.replace("parent.setAttribute('aria-expanded','true')", "parent.setAttribute('aria-expanded','false')"));
  const bad = await checkInteractions(page, { timeout: 80, menus: [{ selector: '#bar', steps: [menuStep('ArrowDown', '#c1')] }] });
  assert.ok(bad.findings.some(f => f.rule === 'control-state'));
}));

test('lazy submenus can create their expected focus target on the key action', async () => withPage(async page => {
  await page.setContent(shell(`<div id="bar" role="menubar" aria-label="Tools"><button id="parent" role="menuitem" tabindex="0" aria-haspopup="menu" aria-expanded="false" aria-controls="child">Views</button></div>
<script>(()=>{document.querySelector('#parent').addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();const child=document.createElement('div');child.id='child';child.setAttribute('role','menu');child.innerHTML='<button id="lazy" role="menuitem" tabindex="-1">List</button>';document.querySelector('#bar').append(child);e.target.setAttribute('aria-expanded','true');document.querySelector('#lazy').focus()}})})();</script>`));
  passed(await checkInteractions(page, { menus: [{ selector: '#bar', steps: [menuStep('ArrowDown', '#lazy')] }] }));
}));

test('menus support removal on close and check action outcomes after focus return', async () => withPage(async page => {
  await page.setContent(menu().replace('root.hidden=true;', "root.remove();opener.removeAttribute('aria-controls');"));
  passed(await checkInteractions(page, { menus: [{ selector: '#menu', open: '#open', steps: [menuStep('End', '#m5'), { key: 'Enter', focus: '#open', outcome: '#status', expectedText: 'Saved' }] }] }));
  await page.setContent(menu().replace('root.hidden=true;', "root.remove();opener.removeAttribute('aria-controls');"));
  passed(await checkInteractions(page, { menus: [{ selector: '#menu', open: '#open', steps: [menuStep('Escape', '#open')] }] }));
}));

test('Escape and Tab must close popup menus instead of only moving focus', async () => withPage(async page => {
  for (const key of ['Escape', 'Tab', 'Shift+Tab'] as const) {
    const handler = key === 'Escape' ? "function close(){opener.focus()}" : "function close(){root.hidden=true;opener.setAttribute('aria-expanded','false');opener.focus()}";
    const fixture = menu().replace(/function close\(\)\{[^}]*\}/, handler).replace("if(e.key===next||e.key===prev)", `if(e.key==='${key}'&&e.key!=='Escape'){e.preventDefault();opener.focus()}else if(e.key===next||e.key===prev)`);
    await page.setContent(fixture);
    const result = await checkInteractions(page, { timeout: 80, menus: [{ selector: '#menu', open: '#open', steps: [menuStep(key, '#open')] }] });
    assert.ok(result.findings.some(f => f.actual === 'the exit key left the menu open'), key);
  }
}));

test('navigation checks choices after DOM replacement and reports missing stable IDs for review', async () => withPage(async page => {
  for (const stable of [true, false]) {
    await page.setContent(menu());
    await page.evaluate(stable => document.querySelector<HTMLElement>('#menu')!.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown') return;
      const old = document.querySelector('#m1')!, replacement = old.cloneNode(true) as HTMLElement;
      replacement.setAttribute('aria-checked', 'true');
      if (!stable) replacement.removeAttribute('id');
      old.replaceWith(replacement);
    }), stable);
    const result = await checkInteractions(page, { timeout: 100, menus: [{ selector: '#menu', open: '#open', steps: [menuStep('ArrowDown', '#m2')] }] });
    assert.ok(result.findings.some(f => f.rule === 'control-state' && f.status === (stable ? 'failed' : 'unresolved')), JSON.stringify(result.findings));
  }
}));

test('menubar entry can use its last focused item or an active-descendant container', async () => withPage(async page => {
  for (const descendant of [false, true]) {
    await page.setContent(menu({ menubar: true, horizontal: true, descendant }));
    if (descendant) await page.locator('#menu').evaluate(el => { el.tabIndex = 0; el.setAttribute('aria-activedescendant', 'm2'); });
    else {
      await page.locator('#m1').evaluate(el => el.tabIndex = -1);
      await page.locator('#m2').evaluate(el => el.tabIndex = 0);
    }
    await page.locator('#menu').evaluate(el => el.addEventListener('keydown', event => {
      if ((event as KeyboardEvent).key === 'ArrowRight') { event.preventDefault(); event.stopImmediatePropagation(); const item = document.querySelector('#m3')!; if (el.hasAttribute('aria-activedescendant')) el.setAttribute('aria-activedescendant', item.id); else (item as HTMLElement).focus(); }
    }, { capture: true }));
    passed(await checkInteractions(page, { menus: [{ selector: '#menu', steps: [menuStep('ArrowRight', '#m3')] }] }));
  }
}));

test('activation plans cannot use stale checkbox states or declare the wrong selected tab', async () => withPage(async page => {
  await page.setContent(menu());
  await assert.rejects(checkInteractions(page, { menus: [{ selector: '#menu', open: '#open', steps: [menuStep('Space', '#m1', [choice('#m1', false)])] }] }), /already matches/);
  await page.setContent(menu());
  await assert.rejects(checkInteractions(page, { menus: [{ selector: '#menu', open: '#open', steps: [menuStep('ArrowDown', '#m2'), menuStep('Enter', '#m2', [choice('#m2', false)])] }] }), /true checked state/);
  await page.setContent(tabs({ manual: true }));
  await assert.rejects(checkInteractions(page, { tabs: [{ selector: '#tabs', steps: [tabStep('ArrowRight', '#t2', '#t1'), tabStep('Enter', '#t2', '#t1')] }] }), /focused tab/);
}));

test('tab panels can show child content without a wrapper box', async () => withPage(async page => {
  for (const style of ['display:contents', 'height:0']) {
    const fixture = tabs().replace('<body>', '<body><style>[hidden]{display:none!important}#after{display:block;margin-top:40px}</style>')
      .replaceAll('role="tabpanel"', `role="tabpanel" style="${style}"`)
      .replace(/>Panel (\d)<\/section>/g, '><span>Panel $1</span></section>');
    await page.setContent(fixture);
    passed(await checkInteractions(page, { tabs: [{ selector: '#tabs', steps: [tabStep('ArrowRight', '#t2')] }] }));
    await page.setContent(fixture);
    await page.locator('#p3').evaluate(el => (el as HTMLElement).hidden = false);
    const result = await checkInteractions(page, { timeout: 100, tabs: [{ selector: '#tabs', steps: [tabStep('ArrowRight', '#t2')] }] });
    assert.ok(result.findings.some(f => f.rule === 'control-state'));
  }
}));
