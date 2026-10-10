import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { checkPage, validatePolicy } from '../src/index.js';

const fixture = (content, style = '') => `<!doctype html><html lang="en"><style>
html { background: white; color: #202020; font: 16px/24px system-ui; }
body { margin: 24px; } p { margin: 0; }
.box { width: 120px; ${style} }
.wide { white-space: nowrap; }
</style><body>${content}</body></html>`;

test('marked text stays inside its container without rejecting wrapping or local scrolling', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const entry of [
        { name: 'visible text outside a marked card', html: fixture('<div class="box" data-ui-content><p class="wide">Customer research archive</p></div>'), count: 1 },
        { name: 'inline text outside a marked card', html: fixture('<div class="box" data-ui-content><p class="wide"><span>Customer research archive</span></p></div>'), count: 1 },
        { name: 'a text element can be the container', html: fixture('<p class="box wide" data-ui-content>Customer research archive</p>'), count: 1 },
        { name: 'border does not enlarge the content area', html: fixture('<div class="box" data-ui-content><p class="wide">Customer research archive</p></div>', 'border: 32px solid #ddd;'), count: 1 },
        { name: 'vertical overflow', html: fixture('<div class="box" data-ui-content><p>Customer research archive</p></div>', 'height: 8px;'), count: 1 },
        { name: 'wrapped text fits', html: fixture('<div class="box" data-ui-content><p>Customer research archive</p></div>'), count: 0 },
        { name: 'unmarked layouts are unchanged', html: fixture('<div class="box"><p class="wide">Customer research archive</p></div>'), count: 0 },
        { name: 'hidden text is excluded', html: fixture('<div class="box" data-ui-content><p>Visible</p><p class="wide" hidden>Customer research archive</p></div>'), count: 0 },
        { name: 'scrolling inside the marked container', html: fixture('<div class="box" data-ui-content><p class="wide">Customer research archive</p></div>', 'overflow: auto;'), count: 0 },
        { name: 'nested scroll region', html: fixture('<div class="box" data-ui-content><div style="overflow: auto"><p class="wide">Customer research archive</p></div></div>'), count: 0 },
        { name: 'scrolling outside the card does not excuse escaping it', html: fixture('<div style="width: 280px; overflow: auto"><div class="box" data-ui-content><p class="wide">Customer research archive</p></div></div>'), count: 1 },
        { name: 'clipped text uses the existing clipping rule', html: fixture('<div class="box" data-ui-content><p class="wide">Customer research archive</p></div>', 'overflow: hidden;'), count: 0, clipping: true },
        { name: 'nested containers use the nearest boundary', html: fixture('<div style="width: 280px" data-ui-content><div class="box" data-ui-content><p class="wide">Customer research archive</p></div></div>'), count: 1 },
      ]) {
        await page.setContent(entry.html);
        const report = await checkPage(page);
        const findings = report.findings.filter(finding => finding.rule === 'content-overflow');
        assert.equal(findings.length, entry.count, `${width}px ${entry.name}: ${JSON.stringify(report.findings)}`);
        if (entry.name === 'visible text outside a marked card') assert.deepEqual(report.findings.map(finding => finding.rule), ['content-overflow']);
        assert.ok(findings.every(finding => finding.actual && finding.expected && finding.fix && finding.relatedSelector));
        if (entry.clipping) assert.ok(report.findings.some(finding => finding.rule === 'content-clipping'));
      }
    }
    await page.setContent(fixture('<div class="box" data-ui-content><p class="wide">Customer research archive</p></div>'));
    const policy = { exceptions: [{ selector: '.wide', rules: ['content-overflow'], reason: 'Test the existing exception contract.' }] };
    validatePolicy(policy);
    const report = await checkPage(page, policy);
    assert.ok(!report.findings.some(finding => finding.rule === 'content-overflow'));
    assert.equal(report.suppressed.filter(finding => finding.rule === 'content-overflow').length, 1);
  } finally { await browser.close(); }
});
