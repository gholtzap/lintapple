import type { Policy } from '../src/types.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { checkPage, validatePolicy } from '../src/index.js';

test('control-size rules validate selectors, limits, viewport ranges, and unknown fields', () => {
  const rule = { selector: '.compact', minSize: 24, minViewportWidth: 760, maxViewportWidth: 1440 };
  assert.deepEqual(validatePolicy({ controlSizeRules: [rule] }).controlSizeRules, [rule]);
  for (const invalid of [null, {}, { ...rule, selector: '' }, { ...rule, minSize: 0 },
    { ...rule, minSize: '24' }, { ...rule, minViewportWidth: 1.5 },
    { ...rule, maxViewportWidth: 0 }, { ...rule, maxViewportWidth: 10001 },
    { ...rule, minViewportWidth: 1441 }, { ...rule, typo: 24 }])
    assert.throws(() => validatePolicy({ controlSizeRules: [invalid] }), /control size rule|viewport/i);
  assert.throws(() => validatePolicy({ controlSizeRules: {} }), /controlSizeRules/);
});

test('rendered controls use the first matching size rule at viewport boundaries', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<html><style>html { background: white; font-family: system-ui; }
      button { font: inherit; width: 24px; height: 24px; padding: 0; border: 0; }
      </style><body><button class="compact">A</button><button>B</button></body></html>`);
    const policy: Partial<Policy> = { minControlSize: 32, controlSizeRules: [
      { selector: '.compact', minSize: 24, minViewportWidth: 760, maxViewportWidth: 1440 },
      { selector: '.compact', minSize: 40 },
    ] };
    for (const width of [759, 760, 1440, 1441]) {
      await page.setViewportSize({ width, height: 900 });
      const errors = (await checkPage(page, policy)).findings.filter(f => f.rule === 'control-size');
      const inRange = width >= 760 && width <= 1440;
      assert.equal(errors.length, inRange ? 1 : 2, `width ${width}`);
      assert.ok(errors.some(f => f.expected.includes('32px')), 'Unmatched controls retain the global minimum');
      if (!inRange) assert.ok(errors.some(f => f.expected.includes('40px')));
    }
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.locator('.compact').evaluate(el => el.style.width = '23px');
    assert.equal((await checkPage(page, policy)).findings.filter(f => f.rule === 'control-size').length, 2);
    await assert.rejects(checkPage(page, { controlSizeRules: [{ selector: '[', minSize: 24 }] }));
  } finally { await browser.close(); }
});
