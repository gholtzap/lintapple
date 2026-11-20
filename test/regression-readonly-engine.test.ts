import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';
import { auditCases, html } from './audit-cases.js';

const content = '<p>Project details</p>';
test('B019: read-only app globals do not stop page checks', () => auditCases('b019', 'text-contrast', [
  { name: 'read-only axe', html: html('', `${content}<script>Object.defineProperty(window,'axe',{value:{sentinel:'App-owned engine'},writable:false,configurable:false})</script>`), expected: [] },
  { name: 'throwing setter', html: html('', `${content}<script>Object.defineProperty(window,'axe',{get(){return {sentinel:'App-owned engine'}},set(){throw Error('App global changed')},configurable:false})</script>`), expected: [] },
  { name: 'writable axe', html: html('', `${content}<script>window.axe={sentinel:'App-owned engine'}</script>`), expected: [] },
]));
test('B019: checks preserve the app property descriptor', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html('', content));
    await page.evaluate(() => Object.defineProperty(window, 'axe', { value: { sentinel: 'App-owned engine' }, writable: false, configurable: false }));
    for (let repeat = 0; repeat < 2; repeat++) await checkPage(page);
    assert.deepEqual(await page.evaluate(() => Object.getOwnPropertyDescriptor(window, 'axe')), { value: { sentinel: 'App-owned engine' }, writable: false, configurable: false, enumerable: false });
  } finally { await browser.close(); }
});
