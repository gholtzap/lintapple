import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkInteractions } from '../src/index.js';
import { mkdir, writeFile } from 'node:fs/promises';

test('focus checks use painted coverage and preserve pointer styles', async () => {
  const browser = await chromium.launch();
  await mkdir('test-results', { recursive: true });
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, colorScheme });
      for (const [name, layer, cover, status] of [
        ['clear', 'opacity:0', '', 'passed'],
        ['opaque', '', '', 'failed'],
        ['no-pointer', 'pointer-events:none', '', 'failed'],
        ['inline-priority', 'pointer-events:none!important', 'pointer-events:none!important', 'failed'],
        ['partial-opacity', 'opacity:.5', '', 'unresolved'],
      ] as const) {
        await page.setContent(`<!doctype html><html lang="en"><style>html{background:white;color:#111;font:16px/24px system-ui}body{margin:24px}button{font:inherit;color:#111;background:white;border:1px solid #111}button:focus-visible{outline:3px solid blue;outline-offset:2px}#target{position:fixed;left:40px;top:40px;width:140px;height:48px}#layer{position:fixed;inset:0}#cover{position:fixed;left:30px;top:30px;width:160px;height:68px;background:white}</style><body><button id="target">Save changes</button><div id="layer" style="${layer}"><div id="cover" style="${cover}"></div></div></body></html>`);
        const before = await page.locator('[style]').evaluateAll(elements => elements.map(el => el.getAttribute('style')));
        const report = await checkInteractions(page, { focus: [{ selector: '#target' }], timeout: 150 });
        const check = report.checks.find(check => check.rule === 'focus-obscured');
        assert.equal(check?.status, status, `${name}: ${JSON.stringify(report.findings)}`);
        assert.equal(await page.locator('#target').evaluate(el => el === document.activeElement), true);
        assert.deepEqual(await page.locator('[style]').evaluateAll(elements => elements.map(el => el.getAttribute('style'))), before);
        await writeFile(`test-results/focus-coverage-${name}-${width}-${colorScheme}.json`, JSON.stringify(report, null, 2));
      }
      await page.close();
    }
  } finally { await browser.close(); }
});
