import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';
import { html } from './audit-cases.js';

test('an opaque background isolates placeholder contrast from ancestor backdrop filters', async () => {
  const browser = await chromium.launch({ channel: process.env.LINTAPPLE_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent(html(`
      header { backdrop-filter: blur(16px); background: #ffffffe0; }
      .field { display: flex; align-items: center; width: 320px; height: 44px; padding: 0 24px; border-radius: 20px; background: #eeefec; }
      input { flex: 1; height: 32px; border: 0; background: transparent; }
      input::placeholder { color: #646c61; opacity: 1; }
      #faint::placeholder { color: #bbb; }
      .transparent { background: #eeefec80; }
      .opacity { opacity: .8; }
      .clipped { background-clip: text; }
    `, `
      <header>
        <div class="field"><input id="clear" aria-label="Clear" placeholder="Search workspace"></div>
        <div class="field"><input id="faint" aria-label="Faint" placeholder="Search workspace"></div>
        <div class="field transparent"><input id="transparent" aria-label="Transparent" placeholder="Search workspace"></div>
        <div class="field opacity"><input id="opacity" aria-label="Opacity" placeholder="Search workspace"></div>
        <div class="field clipped"><input id="clipped" aria-label="Clipped" placeholder="Search workspace"></div>
      </header>
    `));
    const findings = (await checkPage(page)).findings.filter(f => f.rule === 'text-contrast');
    const results = await page.evaluate(items => Object.fromEntries(items.map(f =>
      [document.querySelector(f.selector)?.id, [f.status, f.contrastRatio]])), findings);
    assert.deepEqual(results, {
      faint: ['failed', 1.66],
      transparent: ['unresolved', undefined],
      opacity: ['unresolved', undefined],
      clipped: ['unresolved', undefined],
    });
  } finally { await browser.close(); }
});
