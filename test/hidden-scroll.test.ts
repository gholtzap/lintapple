import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';

test('inert drawers are excluded and text in a nested scroll region stays reachable', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(`<html><style>
      html { background: white; font: 16px system-ui; }
      .drawer { position: fixed; top: 0; left: -200px; width: 200px; }
      .frame { height: 100px; overflow: hidden; }
      .scroll { height: 100px; overflow: auto; }
      .content { height: 400px; display: flex; align-items: end; }
      </style><body><nav class="drawer" inert><button>Hidden action</button></nav>
      <div class="frame"><div class="scroll"><div class="content"><p>Reachable text</p></div></div></div>
      <p>Page content</p></body></html>`);
    const result = await checkPage(page);
    assert.ok(!result.findings.some(f => ['viewport-bounds', 'content-clipping'].includes(f.rule)), JSON.stringify(result.findings));
    await page.locator('.drawer').evaluate(el => el.removeAttribute('inert'));
    assert.ok((await checkPage(page)).findings.some(f => f.rule === 'viewport-bounds'), 'An active drawer outside the viewport still fails');
    await page.locator('.drawer').evaluate(el => el.setAttribute('inert', ''));
    await page.locator('.scroll').evaluate(el => el.style.overflow = 'visible');
    assert.ok((await checkPage(page)).findings.some(f => f.rule === 'content-clipping'), 'Text without a scroll path still fails');
  } finally { await browser.close(); }
});
