import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';
import { html } from './audit-cases.js';

test('visual geometry and form labels handle hidden controls independently', async () => {
  const browser = await chromium.launch({ channel: process.env.LINTAPPLE_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent(html(`
      .hidden, #skip:not(:focus) {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; white-space: nowrap; border: 0; clip-path: inset(50%);
      }
      #skip, #small, #dismiss, #cropped { width: 10px; height: 10px; padding: 0; border: 0; }
      #skip:not(:focus), #dismiss { width: 1px; height: 1px; }
      #clip { width: 11px; height: 11px; overflow: hidden; }
    `, `
      <div class="hidden"><button id="dismiss" aria-label="Dismiss" tabindex="-1"></button></div>
      <div class="hidden" aria-hidden="true">
        <select id="proxy" tabindex="-1"><option>All projects</option></select>
      </div>
      <button id="skip" aria-label="Skip"></button>
      <button id="small" aria-label="Small"></button>
      <div id="clip"><button id="cropped" aria-label="Cropped" style="height:44px;width:44px"></button></div>
      <select id="unlabelled"><option>All projects</option></select>
      <div aria-hidden="true"><input id="hidden-focus"></div>
      <div class="hidden"><input id="sr-unlabelled" tabindex="-1"></div>
    `));
    const targets = async () => {
      const { findings } = await checkPage(page);
      return page.evaluate(items => items.map(({ rule, selector }) => ({
        rule, id: document.querySelector(selector)?.id,
      })), findings.filter(f => ['control-size', 'form-label', 'keyboard-operation'].includes(f.rule)));
    };
    const ids = (items: Awaited<ReturnType<typeof targets>>, rule: string) =>
      items.filter(item => item.rule === rule).map(item => item.id).sort();

    assert.match(await page.locator('#dismiss').ariaSnapshot(), /button "Dismiss"/);
    const before = await targets();
    assert.deepEqual(ids(before, 'control-size'), ['cropped', 'small']);
    assert.deepEqual(ids(before, 'form-label'), ['sr-unlabelled', 'unlabelled']);
    assert.ok(ids(before, 'keyboard-operation').length, 'aria-hidden focus targets still fail');
    await page.locator('#skip').focus();
    assert.deepEqual(ids(await targets(), 'control-size'), ['cropped', 'skip', 'small']);
  } finally { await browser.close(); }
});
