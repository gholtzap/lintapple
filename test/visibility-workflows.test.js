import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const { checkPage, checkInteractions } = await import(process.env.LINTAPPLE_PACKAGE || '../src/index.js');
const execute = promisify(execFile);
const shell = content => `<!doctype html><html lang="en"><title>Visibility checks</title><style>
html{background:white;color:#202020;font:16px/24px system-ui}body{margin:24px}p{margin:0}
button{font:16px/24px system-ui;min-height:40px;padding:8px;margin:8px;background:white;color:#202020}
button:focus-visible{outline:3px solid blue}[hidden]{display:none!important}
</style><body>${content}</body></html>`;
const panelStyle = mode => mode === 'contents' ? 'display:contents' : mode === 'zero' ? 'height:0' : '';
const disclosure = (mode, expanded, hidden = '') => shell(`<button data-ui-disclosure aria-controls="panel" aria-expanded="${expanded}">Project details</button><div id="panel" style="${panelStyle(mode)};${hidden}"><p id="paint">The project is ready for review.</p></div>`);
const menu = (mode, key = 'Escape', nested = false, stable = true) => shell(`
${nested ? '<div id="bar" role="menubar" aria-label="Project tools">' : ''}
<button id="open" ${nested ? 'role="menuitem"' : ''} aria-haspopup="menu" aria-controls="menu" aria-expanded="false">Project actions</button>
<div id="menu" class="popup" role="menu" aria-label="Project actions" hidden><button id="item" ${nested ? 'role="menuitem"' : 'role="menuitemcheckbox" aria-checked="false"'} tabindex="-1">Show notes</button></div>
${nested ? '</div>' : ''}<p>Project details</p><script>(()=>{
const open=document.querySelector('#open');${!stable ? "document.querySelector('#menu').removeAttribute('id');open.removeAttribute('aria-controls');" : ''}
open.addEventListener('keydown',event=>{if(event.key==='${nested ? 'ArrowDown' : 'Enter'}'){event.preventDefault();document.querySelector('.popup').hidden=false;open.setAttribute('aria-expanded','true');document.querySelector('#item').focus();}});
document.querySelector('.popup').addEventListener('keydown',event=>{if(event.key==='${key === 'Shift+Tab' ? 'Tab' : key}'){event.preventDefault();const old=document.querySelector('.popup');window.oldMenu=old;
${mode === 'remove' ? "old.remove();open.removeAttribute('aria-controls');" : mode.startsWith('replace') ? `const replacement=old.cloneNode(true);replacement.hidden=${mode === 'replace-hidden'};old.replaceWith(replacement);` : 'old.hidden=true;'}
open.setAttribute('aria-expanded','${mode === 'replace-visible'}');open.focus();}});})();</script>`);
const plan = (key = 'Escape', nested = false) => ({ timeout: 150, menus: [{ selector: nested ? '#bar' : '.popup', ...(nested ? {} : { open: '#open' }), steps: [...(nested ? [{ key: 'ArrowDown', focus: '#item' }] : []), { key, focus: '#open' }] }] });

test('boxless groups and panels use their visible content without changing box geometry', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const mode of ['normal', 'contents', 'zero']) for (const expanded of [true, false]) {
        await page.setContent(disclosure(mode, expanded));
        assert.equal(await page.locator('#paint').isVisible(), true);
        const report = await checkPage(page);
        assert.deepEqual(report.findings.map(f => f.rule), expanded ? [] : ['control-state'], `${mode}: ${expanded}`);
      }
      for (const mode of ['normal', 'contents', 'zero']) for (const hidden of ['display:none', 'visibility:hidden', 'opacity:0', 'content-visibility:hidden']) {
        await page.setContent(disclosure(mode, false, hidden));
        // These paint properties do not apply to an element without a box.
        const hiddenContent = !(mode === 'contents' && ['opacity:0', 'content-visibility:hidden'].includes(hidden));
        const report = await checkPage(page);
        assert.deepEqual(report.findings.map(f => f.rule), hiddenContent ? [] : ['control-state'], `${mode}: ${hidden}`);
      }
      for (const mode of ['normal', 'contents', 'zero']) for (const aligned of [true, false]) {
        await page.setContent(shell(`<div data-ui-align="start" style="${panelStyle(mode)}"><p data-ui-align-item>Project details</p><p data-ui-align-item style="margin-left:${aligned ? 0 : 32}px;margin-top:16px">Review the project.</p></div>`));
        const report = await checkPage(page);
        assert.equal(report.alignmentGroups, 1);
        assert.deepEqual(report.findings.map(f => f.rule), aligned ? [] : ['layout-alignment']);
      }
      for (const attr of ['hidden', 'inert', 'style="opacity:0"']) {
        await page.setContent(shell(`<div ${attr}><div data-ui-align="start" style="display:contents"><p data-ui-align-item>Project details</p><p data-ui-align-item style="margin-left:32px">Review the project.</p></div></div><p>Visible control text</p>`));
        const report = await checkPage(page);
        assert.equal(report.alignmentGroups, 0);
        assert.deepEqual(report.findings, []);
      }
    }
  } finally { await browser.close(); }
});

test('menu exit checks current roots and nested menus after DOM replacement', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const key of ['Escape', 'Tab', 'Shift+Tab']) for (const nested of [false, true]) for (const mode of ['hide', 'replace-hidden', 'remove', 'replace-visible']) {
        await page.setContent(menu(mode, key, nested));
        const report = await checkInteractions(page, plan(key, nested));
        const visible = await page.locator('.popup').isVisible();
        assert.equal(visible, mode === 'replace-visible');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'open');
        if (mode === 'replace-visible') assert.ok(report.findings.some(f => f.rule === 'keyboard-operation' && f.status === 'failed' && f.actual === 'the exit key left the menu open'), `${key}: ${nested}`);
        else assert.deepEqual(report.findings, [], `${width}: ${key}: ${nested}: ${mode}: ${JSON.stringify(report.findings)}`);
      }
      await page.setContent(menu('replace-visible', 'Escape', true, false));
      const report = await checkInteractions(page, plan('Escape', true));
      assert.ok(report.findings.some(f => f.rule === 'keyboard-operation' && f.status === 'unresolved'));
    }
  } finally { await browser.close(); }
});

test('CLI checks boxless page states after HTTP requests and rejects a visible replacement menu', async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push({ method: request.method, path: request.url });
    if (request.url === '/open') { response.end('The project is ready for review.'); return; }
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/navigate') { response.end(shell('<button id="navigate" onclick="location.href=\'/menu-hide\'">Continue</button><p id="status">Ready</p>')); return; }
    if (request.url.startsWith('/menu-')) {
      if (request.headers.referer?.endsWith('/navigate')) await new Promise(resolve => setTimeout(resolve, 300));
      response.end(menu(request.url.slice(6)).replace('<p>Project details</p>', '<p id="status">Second page</p>')); return;
    }
    const good = request.url !== '/panel-bad';
    response.end(shell(`<button id="open" data-ui-disclosure aria-controls="panel" aria-expanded="false">Project details</button><div id="panel" style="display:contents" hidden><p id="paint"></p></div><script>document.querySelector('#open').onclick=async()=>{const response=await fetch('/open',{method:'POST'});document.querySelector('#paint').textContent=await response.text();document.querySelector('#panel').hidden=false;document.querySelector('#open').setAttribute('aria-expanded','${good}');};</script>`));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await mkdir('test-results/visibility-fix', { recursive: true });
    for (const route of ['panel-good', 'panel-bad', 'menu-hide', 'menu-replace-hidden', 'menu-remove', 'menu-replace-visible', 'navigate']) {
      const interaction = route.startsWith('panel-') ? { states: [{ name: 'Project details', action: 'click', selector: '#open', ready: { selector: '#paint', expectedText: 'The project is ready for review.' } }] } : { ...plan(), timeout: 1500, ...(route === 'navigate' ? { buttons: [{ selector: '#navigate', key: 'Enter', outcome: '#status', expectedText: 'Second page' }] } : {}) };
      const path = `test-results/visibility-fix/${route}-plan.json`;
      await writeFile(path, JSON.stringify(interaction));
      let receipt;
      try { receipt = { code: 0, ...await execute(process.execPath, [process.env.LINTAPPLE_CLI || 'bin/lintapple.js', `http://127.0.0.1:${server.address().port}/${route}`, '--interactions', path, '--json']) }; }
      catch (error) { receipt = { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
      assert.notEqual(receipt.code, 2, receipt.stderr);
      const report = JSON.parse(receipt.stdout);
      assert.equal(receipt.code, ['panel-bad', 'menu-replace-visible'].includes(route) ? 1 : 0, `${route}: ${JSON.stringify(report.findings)}`);
      assert.ok(report.runs.every(run => run.states[0].findings.length === 0));
      if (route === 'panel-bad') assert.ok(report.findings.every(f => f.rule === 'control-state' && f.state === 'Project details'));
      if (route === 'menu-replace-visible') assert.ok(report.findings.some(f => f.actual === 'the exit key left the menu open'));
      await writeFile(`test-results/visibility-fix/${route}-report.json`, JSON.stringify(report, null, 2));
    }
    assert.equal(requests.filter(request => request.method === 'POST').length, 4);
    await writeFile('test-results/visibility-fix/http-requests.json', JSON.stringify(requests, null, 2));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
