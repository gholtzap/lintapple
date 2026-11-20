import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';
import { html } from './audit-cases.js';

test('font checks use painted text and keep accessible labels', async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
      try {
        await page.setContent(html(`
          .sr {position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);font:17px serif}
          #skip:focus {clip:auto;width:auto;height:auto}
          input {font:17px serif;width:64px;height:48px}
        `, `<button aria-label="Save"><span class="sr">Save</span></button>
          <div class="sr"><span style="font:17px serif">Saved</span></div>
          <a id="skip" class="sr" href="#content">Skip to content</a>
          <input type="image" alt="Upload" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Crect width='48' height='48'/%3E%3C/svg%3E">
          <p id="content">Project ready</p>`));
        const fonts = async () => (await checkPage(page)).findings.filter(f => f.rule === 'font-size' || f.rule === 'font-family');
        assert.deepEqual(await fonts(), []);
        assert.match(await page.locator('input').ariaSnapshot(), /Upload/);
        await page.locator('#skip').focus();
        assert.deepEqual((await fonts()).map(f => f.rule).sort(), ['font-family', 'font-size']);
        await page.locator('#skip').blur();
        await page.locator('input').evaluate(el => el.setAttribute('src', 'data:image/png,broken'));
        assert.deepEqual((await fonts()).map(f => f.rule).sort(), ['font-family', 'font-size']);
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
