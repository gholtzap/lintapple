import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const { checkPage } = await import(process.env.LINTAPPLE_PACKAGE || '../src/index.js');
const execute = promisify(execFile);
const shell = content => `<!doctype html><html lang="en"><title>Geometry checks</title><style>
html { background:white; color:#202020; font:16px/24px system-ui; } body { margin:24px; } p { margin:0; }
</style><body>${content}</body></html>`;
const text = '<span id="subject" style="display:contents;font-size:17px;color:#aaa">Project details</span>';
const escape = '<div id="subject" style="position:absolute;left:-40px;top:48px;width:100px;height:40px;background:#a00000"></div>';
const radius = (scale, inner = 12) => `<div data-ui-radius style="width:120px;padding:8px;border-radius:20px;transform:scale(${scale});transform-origin:top left"><div data-ui-radius-inner style="height:64px;border-radius:${inner}px"></div></div>`;

test('painted text, containing blocks, and scaled radii use rendered geometry', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const cases = [
      ['boxless text', `<p>${text}</p>`, ['font-size', 'text-contrast']],
      ['zero-height text box', `<div style="height:0;font-size:17px;color:#aaa">Project details</div>`, ['font-size', 'text-contrast']],
      ['valid boxless text', text.replace('17px;color:#aaa', '16px;color:#202020'), []],
      ['boxless text on inherited dark background', `<p style="background:#202020">${text.replace('17px;color:#aaa', '16px;color:white')}</p>`, []],
      ['transparent boxless text', `<p>${text.replace('17px;color:#aaa', '16px;color:rgba(0,0,0,.2)')}</p>`, ['text-contrast']],
      ['boxless large text meets 3 to 1', text.replace('17px;color:#aaa', '24px;color:#949494'), []],
      ['boxless text with a filter needs review', `<p style="filter:brightness(.5)">${text.replace('17px;color:#aaa', '16px;color:#202020')}</p>`, ['text-contrast']],
      ['boxless text with overlapping content needs review', `<p style="position:relative">${text.replace('17px;color:#aaa', '16px;color:#202020')}<i style="position:absolute;inset:0;background:#aaa"></i></p>`, ['text-contrast']],
      ['boxless text on an image needs review', `<p style="background-image:linear-gradient(white,black)">${text.replace('17px;color:#aaa', '16px;color:#202020')}</p>`, ['text-contrast']],
      ['partial ancestor background needs review', `<div style="height:8px;background:#222">${text.replace('17px;color:#aaa', '16px;color:#202020')}</div>`, ['text-contrast']],
      ['hidden boxless text', `<div hidden>${text}</div>`, []],
      ['inert boxless text', `<div inert>${text}</div>`, []],
      ['transparent ancestor', `<div style="opacity:0">${text}</div>`, []],
      ['opacity on a boxless element does not hide text', text.replace('display:contents', 'display:contents;opacity:0'), ['font-size', 'text-contrast']],
      ['hidden visibility', `<div style="visibility:hidden">${text}</div>`, []],
      ['hidden content', `<div style="content-visibility:hidden">${text}</div>`, []],
      ['boxless text inherits visible override', `<div style="visibility:hidden">${text.replace('display:contents', 'display:contents;visibility:visible')}</div>`, ['font-size', 'text-contrast']],
      ['static scroll ancestor', `<div style="width:200px;height:100px;overflow:auto">${escape}</div>`, ['viewport-bounds']],
      ['static clipping ancestor', `<div style="width:200px;height:100px;overflow:hidden">${escape}</div>`, ['viewport-bounds']],
      ['static clip ancestor', `<div style="width:200px;height:100px;overflow:clip">${escape}</div>`, ['viewport-bounds']],
      ['static clipping ancestor does not cut absolute text', '<div style="width:80px;height:100px;overflow:hidden"><span style="position:absolute;left:120px;top:48px">Project details</span></div>', []],
      ['marked static scroll container cannot contain absolute text', '<div data-ui-content style="width:80px;height:100px;overflow:auto"><span style="position:absolute;left:120px;top:48px">Project details</span></div>', ['content-overflow']],
      ['absolute ancestor and nested child', `<div style="width:200px;height:100px;overflow:auto">${escape.replace('></div>', '><div style="width:100px;height:40px"></div></div>')}</div>`, ['viewport-bounds']],
      ['positioned scroll container', `<div style="position:relative;width:200px;height:100px;overflow:auto">${escape}</div>`, []],
      ['positioned clipping container', `<div style="position:relative;width:200px;height:100px;overflow:hidden">${escape}</div>`, []],
      ['transformed scroll container', `<div style="transform:translateX(0);width:200px;height:100px;overflow:auto">${escape}</div>`, []],
      ['layout-contained scroll container', `<div style="contain:layout;width:200px;height:100px;overflow:auto">${escape}</div>`, []],
      ['intermediate scroll box below containing block', `<div style="position:relative"><div style="width:200px;height:100px;overflow:auto">${escape}</div></div>`, ['viewport-bounds']],
      ['absolute content below an overlay', `<div data-ui-overlay style="width:200px;height:100px;overflow:auto">${escape.replace('left:-40px;top:48px', 'left:40px;top:900px')}</div>`, ['viewport-bounds']],
      ['boxless overflow is not a scroll region', '<div style="display:contents;overflow:auto"><div style="width:1800px;height:40px"></div></div>', ['horizontal-overflow', 'viewport-bounds']],
      ['normal local scrolling', '<div style="width:120px;overflow:auto"><div style="width:1000px">Wide content</div></div>', []],
      ['fractional surface size', radius(1).replace('width:120px', 'width:120.5px'), []],
      ['inner surface scale', '<div data-ui-radius style="width:120px;padding:8px;border-radius:40px"><div data-ui-radius-inner style="height:120px;border-radius:4px;transform:scale(.5)"></div></div>', []],
      ['nonuniform scale violates the circular radius contract', radius(1).replace('scale(1)', 'scale(.5,.75)'), ['nested-radius']],
      ...[0.5, 1, 2].flatMap(scale => [
        [`valid radius at scale ${scale}`, radius(scale), []],
        [`invalid radius at scale ${scale}`, radius(scale, 4), ['nested-radius']],
      ]),
    ];
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [name, content, expected] of cases) {
        await page.setContent(shell(`<main>${content}</main><p style="margin-top:200px">Visible control text</p>`));
        const report = await checkPage(page);
        assert.deepEqual([...new Set(report.findings.map(f => f.rule))].sort(), [...expected].sort(), `${width}px ${name}: ${JSON.stringify(report.findings)}`);
        if (name === 'boxless text') assert.ok(report.findings.some(f => f.rule === 'text-contrast' && f.status === 'failed' && f.contrastRatio === 2.32));
        if (name.includes('needs review')) assert.ok(report.findings.some(f => f.rule === 'text-contrast' && f.status === 'unresolved'));
        if (name === 'static scroll ancestor') {
          assert.equal(await page.evaluate(() => document.elementFromPoint(20, 60)?.id), 'subject');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        }
      }
    }
  } finally { await browser.close(); }
});

test('CLI detects boxless saved text after a real form request', async () => {
  const saved = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/save') {
      let value = ''; for await (const part of request) value += part;
      saved.push(value); response.end(value); return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(shell(`<style>form{width:260px;display:flex;flex-direction:column;gap:8px}input,button{font:14px/20px system-ui;min-height:40px;padding:8px;background:white;color:#202020}[hidden]{display:none}</style>
<form data-ui-stack><label for="name">Project name</label><input id="name" value="Research"><div data-ui-actions data-ui-container style="padding:8px"><button id="save">Save project</button></div>
<p id="result" hidden><span style="display:contents;font-size:${request.url === '/good' ? 16 : 17}px;color:${request.url === '/good' ? '#202020' : '#aaa'}"></span></p></form>
<script>document.querySelector('form').onsubmit=async event=>{event.preventDefault();const response=await fetch('/save',{method:'POST',body:document.querySelector('#name').value});document.querySelector('#result span').textContent='Saved '+await response.text();document.querySelector('#result').hidden=false;};</script>`));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await mkdir('test-results', { recursive: true });
    const plan = 'test-results/rendered-geometry-plan.json';
    await writeFile(plan, JSON.stringify({ states: [{ name: 'Saved result', action: 'click', selector: '#save', ready: { selector: '#result', expectedText: 'Saved Research' } }] }));
    for (const route of ['bad', 'good']) {
      let output;
      try { output = { code: 0, ...await execute(process.execPath, [process.env.LINTAPPLE_CLI || 'bin/lintapple.js', `http://127.0.0.1:${server.address().port}/${route}`, '--interactions', plan, '--json']) }; }
      catch (error) { if (typeof error.code !== 'number') throw error; output = { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
      assert.equal(output.code, route === 'bad' ? 1 : 0, output.stderr);
      const report = JSON.parse(output.stdout);
      for (const run of report.runs) {
        assert.deepEqual(run.states[0].findings, []);
        assert.deepEqual([...new Set(run.states[1].findings.map(f => f.rule))].sort(), route === 'bad' ? ['font-size', 'text-contrast'] : []);
        if (route === 'bad') assert.ok(run.states[1].findings.some(f => f.rule === 'text-contrast' && f.status === 'failed' && f.contrastRatio === 2.32));
      }
      assert.ok(report.findings.every(f => f.state === 'Saved result'));
      await writeFile(`test-results/rendered-geometry-${route}-report.json`, JSON.stringify(report, null, 2));
    }
    assert.equal(saved.length, 4);
    assert.ok(saved.every(value => value === 'Research'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
