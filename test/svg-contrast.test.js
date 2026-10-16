import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';

// An SVG is not an unknown image when its rendered text and background can be measured.
// Pale text must still fail; unsupported foreground paint must remain unresolved.
test('SVG contrast checks rendered backgrounds without changing the page', async () => {
  const browser = await chromium.launch({ channel: process.env.LINTAPPLE_BROWSER_CHANNEL || undefined });
  const results = [];
  try {
    const page = await browser.newPage();
    for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme });
      for (const [name, foreground, background, status] of [
        ['readable light', '#111', '#fff', null], ['readable dark', '#fff', '#111', null],
        ['pale', '#aaa', '#fff', 'failed'], ['overlapping paint', '#111', '#222', 'failed'],
        ['foreground gradient', 'url(#paint)', '#fff', 'unresolved'],
      ]) {
        await page.setContent(`<html lang="en"><style>html{font:14px system-ui;background:#fff;color:#111}body{margin:24px}svg{display:block}</style><body><svg width="300" height="100"><defs><linearGradient id="paint"><stop stop-color="black"/><stop offset="1" stop-color="white"/></linearGradient></defs><rect width="300" height="100" fill="${background}"/><text x="20" y="50" style="fill:${foreground};font:14px system-ui">Chart label</text></svg></body></html>`);
        const before = await page.content();
        const report = await checkPage(page);
        const findings = report.findings.filter(row => row.rule === 'text-contrast');
        if (status) assert.ok(findings.some(row => row.status === status), `${name}: ${JSON.stringify(findings)}`);
        else assert.deepEqual(findings, [], name);
        assert.equal(await page.content(), before, 'Temporary paint changes must be restored.');
        results.push({ name, width, theme, status, findings });
      }
    }
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/svg-contrast.json', JSON.stringify({ passed: true, results }, null, 2));
  } finally { await browser.close(); }
});

test('SVG text below the viewport is measured without changing scroll or viewport state', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    for (const color of ['#111', '#aaa']) {
      await page.setContent(`<html><style>html{font:14px system-ui;background:white;color:black}body{margin:24px}</style><body><div style="height:1200px"></div><svg width="300" height="100"><rect width="300" height="100" fill="white"/><text x="20" y="50" style="fill:${color};font:14px system-ui">Chart label</text></svg></body></html>`);
      const report = await checkPage(page);
      const findings = report.findings.filter(row => row.rule === 'text-contrast');
      if (color === '#111') assert.deepEqual(findings, []);
      else assert.ok(findings.some(row => row.status === 'failed'));
      assert.equal(await page.evaluate(() => scrollY), 0);
      assert.deepEqual(page.viewportSize(), { width: 390, height: 844 });
    }
  } finally { await browser.close(); }
});
