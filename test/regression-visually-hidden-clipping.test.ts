import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';
import { html } from './audit-cases.js';

test('content clipping skips visually hidden text and checks text revealed on focus', async () => {
  const browser = await chromium.launch({ channel: process.env.LINTAPPLE_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent(html(`
      #download span, #status, #skip, #tiny {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; white-space: nowrap; border-width: 0;
      }
      #download span, #skip { clip: rect(0, 0, 0, 0); }
      #status { clip-path: inset(50%); }
      #tiny { clip-path: inset(0); }
      #skip:focus { clip: auto; width: 40px; height: 24px; }
      #paragraph { width: 40px; overflow: hidden; white-space: nowrap; }
    `, `
      <button id="download"><svg aria-hidden="true" width="24" height="24"></svg><span>Download the file</span></button>
      <div id="status" role="status"><span>Download complete</span></div>
      <a id="skip" href="#paragraph">Skip to the download details</a>
      <div id="tiny">Text in a small box</div>
      <p id="paragraph">The download details are ready.</p>
    `));

    const clippingTargets = async () => {
      const report = await checkPage(page);
      assert.ok(!report.findings.some(finding => finding.rule === 'accessible-name'));
      const selectors = report.findings.filter(finding => finding.rule === 'content-clipping').map(finding => finding.selector);
      return page.evaluate(selectors => selectors.map(selector => {
        const element = document.querySelector(selector)!;
        return element.id || element.parentElement!.id;
      }).sort(), selectors);
    };

    assert.match(await page.locator('#download').ariaSnapshot(), /button "Download the file"/);
    assert.match(await page.locator('#status').ariaSnapshot(), /Download complete/);
    assert.deepEqual(await clippingTargets(), ['paragraph', 'tiny']);
    await page.locator('#skip').focus();
    assert.deepEqual(await clippingTargets(), ['paragraph', 'skip', 'tiny']);
  } finally { await browser.close(); }
});
