import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const { checkPage, checkUrl } = await import(process.env.LINTAPPLE_PACKAGE || '../src/index.js');
const run = promisify(execFile);
const shell = (body, css = '') => `<html lang="en"><style>html{background:white;color:#111;font:16px system-ui}body{margin:24px}${css}</style><body>${body}</body></html>`;
const withPage = async callback => {
  const browser = await chromium.launch();
  try { await callback(await browser.newPage({ viewport: { width: 390, height: 844 } })); }
  finally { await browser.close(); }
};

test('display contents text receives font, contrast, and clipping checks without including hidden text', async () => withPage(async page => {
  await page.setContent(shell('<p id="text" style="display:contents;font:11px Georgia;color:#aaa">Project ready</p>'));
  const findings = (await checkPage(page)).findings;
  for (const rule of ['font-family', 'font-size', 'text-contrast']) assert.ok(findings.some(f => f.rule === rule), rule);
  assert.ok(findings.some(f => f.rule === 'text-contrast' && f.status === 'failed'));
  await page.setContent(shell('<p style="display:contents">Project ready</p>'));
  assert.deepEqual((await checkPage(page)).findings, []);
  await page.setContent(shell('<div style="opacity:.2"><p style="display:contents">Faint text</p></div>'));
  assert.ok((await checkPage(page)).findings.some(f => f.rule === 'text-contrast' && f.status === 'unresolved'));
  await page.setContent(shell('<p style="display:contents;-webkit-text-fill-color:#aaa">Pale text</p>'));
  assert.ok((await checkPage(page)).findings.some(f => f.rule === 'text-contrast' && f.status === 'failed'));
  await page.setContent(shell('<button disabled style="color:#aaa;font:inherit"><span style="display:contents">Disabled</span></button>'));
  assert.ok(!(await checkPage(page)).findings.some(f => f.rule === 'text-contrast'));
  for (const hidden of ['display:none', 'opacity:0', 'visibility:hidden', 'content-visibility:hidden']) {
    await page.setContent(shell(`<div style="${hidden}"><p style="display:contents;font:11px Georgia;color:#aaa">Hidden text</p></div><p>Project ready</p>`));
    assert.deepEqual((await checkPage(page)).findings, [], hidden);
  }
  await page.setContent(shell('<div style="width:80px;overflow:hidden;white-space:nowrap"><p style="display:contents">Customer research archive</p></div>'));
  assert.ok((await checkPage(page)).findings.some(f => f.rule === 'content-clipping'));
}));

test('copy checks exclude code without hiding prohibited prose or breaking inline phrases', async () => withPage(async page => {
  for (const [body, count] of [
    ['<section>Unlock your potential<pre><code>Unlock your potential</code></pre></section>', 1],
    ['<section><pre><code>Unlock your potential</code></pre></section>', 0],
    ['<p>Unlock <span>your</span> potential</p>', 1],
    ['<div style="display:contents"><p>Unlock your potential</p></div>', 1],
    ['<p>Unlock <span style="display:contents">your</span> potential</p>', 1],
    ['<p>Unlock <code>your</code> potential</p>', 0],
    ['<p>game-<code>example</code>changing</p>', 0],
    ['<p>Project <span hidden>Unlock your potential</span>ready</p>', 0],
    ['<p>Project <span style="opacity:0">Unlock your potential</span>ready</p>', 0],
  ]) {
    await page.setContent(shell(body));
    assert.equal((await checkPage(page)).findings.filter(f => f.rule === 'copy').length, count, body);
  }
}));

test('supplied invalid plans fail through the URL API and CLI before navigation', async () => {
  let requests = 0;
  const server = createServer((req, res) => { requests++; res.setHeader('Content-Type', 'text/html'); res.end(shell('<p>Project ready</p>')); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const directory = await mkdtemp(join(tmpdir(), 'lintapple-invalid-plans-'));
  try {
    for (const plan of [null, false, 0, '']) {
      await assert.rejects(checkUrl(origin, {}, { interactions: plan }), /Interaction plan must be an object/);
      const path = join(directory, 'plan.json');
      await writeFile(path, JSON.stringify(plan));
      await assert.rejects(run(process.execPath, [process.env.LINTAPPLE_CLI || resolve('bin/lintapple.js'), origin, '--interactions', path, '--json']), error => error.code === 2 && !error.stdout && /Interaction plan must be an object/.test(error.stderr));
    }
    assert.equal(requests, 0, 'Invalid plans must fail before the page can load.');
    assert.deepEqual((await checkUrl(origin)).findings, []);
    assert.deepEqual((await checkUrl(origin, {}, { interactions: {} })).findings, []);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});

test('radius checks use the same coordinates at normal and scaled sizes', async () => withPage(async page => {
  for (const scale of [1, 0.5, 1.5]) for (const radius of [16, 20]) {
    await page.setContent(shell(`<div data-ui-radius class="outer"><div data-ui-radius-inner class="inner">Project ready</div></div>`, `.outer{width:200px;height:160px;box-sizing:border-box;padding:8px;border-radius:24px;transform:scale(${scale});transform-origin:top left}.inner{width:100%;height:100%;border-radius:${radius}px}`));
    assert.equal((await checkPage(page)).findings.filter(f => f.rule === 'nested-radius').length, radius === 16 ? 0 : 1, `${scale}: ${radius}`);
  }
  await page.setContent(shell('<div data-ui-radius class="outer"><div data-ui-radius-inner class="inner">Project ready</div></div>', '.outer{width:200.4px;height:160.6px;box-sizing:border-box;padding:8px;border-radius:24px}.inner{width:100%;height:100%;border-radius:16px}'));
  assert.deepEqual((await checkPage(page)).findings, [], 'Fractional layout sizes must pass.');
}));

test('numeric alignment resolves both text directions', async () => withPage(async page => {
  for (const direction of ['ltr', 'rtl']) for (const alignment of ['left', 'right', 'start', 'end']) {
    await page.setContent(shell(`<table style="width:240px"><tr><td style="direction:${direction};text-align:${alignment};font-variant-numeric:tabular-nums">120</td></tr></table>`));
    const right = alignment === 'right' || alignment === (direction === 'rtl' ? 'start' : 'end');
    assert.equal((await checkPage(page)).findings.filter(f => f.rule === 'numeric-alignment').length, right ? 0 : 1, `${direction}: ${alignment}`);
  }
}));
