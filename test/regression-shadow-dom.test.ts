import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';
import { html } from './audit-cases.js';

test('page checks find open shadow content and preserve scoped references', async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
      try {
        await page.setContent(html('report-card{display:block}', `<p>Project ready</p><report-card></report-card><script>
          const root = document.querySelector('report-card').attachShadow({mode:'open'});
          root.innerHTML = '<style>:host{font:16px system-ui}p{font:17px serif;color:#aaa}button{font:16px system-ui;height:48px;padding:8px}svg{display:block}</style><p>Project details</p><label id="label">Name</label><input aria-labelledby="label" style="font:16px system-ui"><button>Save</button><div id="nested"></div>';
          root.querySelector('#nested').attachShadow({mode:'open'}).innerHTML = '<p style="font:17px serif">Nested details</p>';
        </script>`));
        const report = await checkPage(page);
        for (const rule of ['font-family', 'font-size', 'text-contrast']) assert.ok(report.findings.some(f => f.rule === rule && f.selector.includes(' >> ')), rule);
        assert.equal(report.findings.filter(f => f.rule === 'font-family').length, 2);
        assert.ok(!report.findings.some(f => f.rule === 'aria-reference' || f.rule === 'form-label'));
        assert.equal(report.controls, 1);
        for (const f of report.findings.filter(f => ['font-size', 'font-family'].includes(f.rule))) assert.equal(await page.locator(f.selector).count(), 1);
        await page.locator('report-card').evaluate(el => (el as HTMLElement).style.display = 'none');
        const hidden = await checkPage(page);
        assert.ok(!hidden.findings.some(f => f.selector.includes(' >> ')));
        assert.equal(hidden.controls, 0);
        await page.setContent(html('report-card{display:block}', '<report-card></report-card>'));
        await page.locator('report-card').evaluate(el => {
          el.attachShadow({ mode: 'open' }).innerHTML = '<svg width="200" height="40"><text x="0" y="24" style="font:16px system-ui;fill:#aaa">Project ready</text></svg>';
        });
        const svg = await checkPage(page);
        assert.ok(svg.findings.some(f => f.rule === 'text-contrast' && f.selector.includes(' >> ') && f.selector.endsWith('text:nth-of-type(1)')));

      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
