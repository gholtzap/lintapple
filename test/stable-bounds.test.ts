import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkInteractions } from '../src/index.js';
import { validateInteractions } from '../src/interactions.js';
import type { InteractionPlan } from '../src/types.js';
import { html } from './audit-cases.js';

const plan: Partial<InteractionPlan> = { states: [{
  name: 'Increase revision count',
  action: 'click', selector: '#increase', ready: { selector: '#count', expectedText: '10' },
  stableBounds: [
    { selector: '#count', properties: ['width'] },
    { selector: '#increase', properties: ['x'], tolerance: 0.5 },
    { selector: '#disappears' },
  ],
}] };

test('stable bounds report growth, movement, and disappearing elements', async () => {
  const browser = await chromium.launch({ channel: process.env.LINTAPPLE_BROWSER_CHANNEL || undefined });
  try {
    const page = await browser.newPage();
    for (const changed of [false, true]) {
      await page.setContent(html(`
        .row { display:flex; align-items:center; gap:12px; }
        #count { width:70px; font-variant-numeric:tabular-nums; }
      `, `
        <div class="row"><span data-ui-number id="count">9</span><button id="increase">Increase</button><span id="disappears">Changes</span></div>
        <script>
          document.querySelector('#increase').onclick = () => {
            const count = document.querySelector('#count');
            count.textContent = '10';
            if (${changed}) { count.style.width = '86px'; document.querySelector('#disappears').remove(); }
          };
        </script>
      `));
      const { checks, findings } = await checkInteractions(page, plan);
      const bounds = findings.filter(f => f.rule === 'layout-stability');
      assert.equal(bounds.length, changed ? 3 : 0);
      assert.equal(checks.filter(c => c.rule === 'layout-stability' && c.status === 'passed').length, changed ? 0 : 3);
      assert.ok(bounds.every(f => f.state === 'Increase revision count' && f.category === 'design'));
      assert.equal(findings.some(f => f.rule === 'tabular-numbers'), false);
      if (changed) {
        assert.match(bounds[0].actual, /70px to 86px/);
        assert.match(bounds[1].actual, /^x changed/);
        assert.match(bounds[2].actual, /disappeared/);
      }
    }
  } finally { await browser.close(); }
});

test('stable bounds validates measurements before a named action can run', () => {
  const state = plan.states![0];
  for (const stableBounds of [[], [{ selector: '#count', tolerance: -1 }], [{ selector: '#count', properties: ['left'] }],
    [{ selector: '#count', properties: ['width', 'width'] }], [{ selector: '#count' }, { selector: '#count' }]])
    assert.throws(() => validateInteractions({ states: [{ ...state, stableBounds }] }), /stable bounds|stableBounds/i);
});
