import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkInteractions } from '../src/index.js';
import { html } from './audit-cases.js';

const plan = { states: [{ name: 'Change count', action: 'click' as const, selector: '#change', ready: { selector: '#change' }, stableBounds: [{ selector: '#value' }] }] };
const fixture = (hidden: boolean) => html('#value{display:block;width:80px;height:30px}', `<div id="group" style="opacity:${hidden ? 0 : 1}"><span id="value">9</span></div><button id="change">Change</button><script>document.querySelector('#change').onclick=()=>{document.body.dataset.clicked='yes';document.querySelector('#group').style.opacity='0';document.querySelector('#value').textContent='10'}</script>`);

test('stable bounds reject invisible baselines before running an action and report hidden results', async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
      await page.setContent(fixture(true));
      await assert.rejects(checkInteractions(page, plan), /visible before the action/);
      assert.equal(await page.locator('body').getAttribute('data-clicked'), null);
      await page.setContent(fixture(false));
      const report = await checkInteractions(page, plan);
      const bounds = report.findings.filter(f => f.rule === 'layout-stability');
      assert.equal(bounds.length, 1);
      assert.match(bounds[0].actual, /disappeared/);
      assert.equal(report.checks.some(c => c.rule === 'layout-stability' && c.status === 'passed'), false);
      await page.close();
    }
  } finally { await browser.close(); }
});
