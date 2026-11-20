import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { checkPage, checkUrl } from '../src/index.js';
import { expectUI } from '../src/playwright.js';
import type { PageReport } from '../src/types.js';

const shell = (body: string) => `<html lang="en"><head><title>Frame coverage</title><style>html { font:16px system-ui; background:white; color:black } body {margin:16px} iframe {width:300px;height:200px;border:0} h1 {font-size:37px}</style></head><body>${body}</body></html>`;

test('reports list omitted same-origin, cross-origin, and nested frames; explicit frame checks find defects', async () => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    const port = (server.address() as AddressInfo).port;
    response.end(shell(request.url === '/frame' ? '<h1>Frame defect</h1><iframe title="Nested page" src="/leaf"></iframe>' : request.url === '/leaf' ? '<p>Nested page</p>' : `<p>Toolbar</p><iframe name="same" title="Same-origin page" src="/frame"></iframe><iframe name="cross" title="Cross-origin page" src="http://localhost:${port}/frame"></iframe>`));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url);
    const report = await checkPage(page);
    assert.equal(report.findings.length, 0, JSON.stringify(report.findings));
    assert.equal(report.frameCoverage.checked.url, url);
    assert.equal(report.frameCoverage.omitted.length, 4);
    assert.deepEqual(report.frameCoverage.omitted.map(frame => frame.path), ['main/0', 'main/0/0', 'main/1', 'main/1/0']);
    assert.ok(report.frameCoverage.omitted.some(frame => frame.name === 'cross' && frame.url.includes('localhost')));
    const child = page.frame({ name: 'same' });
    assert.ok(child);
    const checked = await checkPage(child);
    assert.ok(checked.findings.some(f => f.rule === 'font-size' && f.documentUrl === child.url()));
    assert.equal(checked.frameCoverage.checked.name, 'same');
    assert.equal(checked.frameCoverage.checked.path, 'main/0');
    assert.equal(checked.frameCoverage.omitted.length, 1);
    const attachments: { name: string; body: Buffer | string | undefined }[] = [];
    await expectUI(page, { attach: async (name, options) => { attachments.push({ name, body: options?.body }); } });
    assert.equal(attachments[0].name, 'lintapple coverage');
    const attached: PageReport = JSON.parse(attachments[0].body!.toString());
    assert.equal(attached.frameCoverage.omitted.length, 4);
    const urlReport = await checkUrl(url, { viewports: [{ width: 1440, height: 900 }] });
    assert.equal(urlReport.summary.problems, 0);
    assert.equal(urlReport.runs[0].states[0].frameCoverage.omitted.length, 4);
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject: (reason?: unknown) => void) => server.close(error => error ? reject(error) : resolve()));
  }
});
