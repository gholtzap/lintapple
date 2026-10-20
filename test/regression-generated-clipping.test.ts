import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';
import { auditCases, html } from './audit-cases.js';

const css = '#subject{width:100px;height:24px;overflow:hidden;white-space:nowrap}';
test('B024: clipping checks include generated text', () => auditCases('b024', 'content-clipping', [
  ...['before', 'after'].map(pseudo => ({ name: `clipped ${pseudo}`, html: html(`${css}#subject::${pseudo}{content:"Project review is complete"}`, '<div id="subject"></div>'), expected: ['failed' as const] })),
  { name: 'content policy', html: html(`${css}#subject::before{content:"Project review is complete"}`, '<div id="subject"></div>').replace('<style>', `<meta http-equiv="Content-Security-Policy" content="style-src 'nonce-YXVkaXQ='"><style nonce="YXVkaXQ=">`), expected: ['failed'] },
  { name: 'important content needs review', html: html(`${css}#subject::before{content:"Project review is complete"!important}`, '<div id="subject"></div>'), expected: ['unresolved'] },
  { name: 'text fits', html: html(`${css}#subject::before{content:"Project"}`, '<div id="subject"></div>'), expected: [] },
  { name: 'wide box with short text', html: html('#clip{width:100px;overflow:hidden}#subject{width:300px}#subject::before{content:"Project"}', '<div id="clip"><div id="subject"></div></div>'), expected: [] },
  { name: 'DOM control', html: html(css, '<div id="subject">Project review is complete</div>'), expected: ['failed'] },
]));
test('B024: generated text measurement restores the document', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html(`${css}#subject::before{content:"Project review is complete"}`, '<div id="subject"></div>'));
    await page.evaluate(() => { const sheet = new CSSStyleSheet(); sheet.replaceSync('body{margin:24px}'); document.adoptedStyleSheets = [sheet]; });
    const before = await page.content();
    await checkPage(page);
    assert.equal(await page.content(), before);
    assert.deepEqual(await page.evaluate(() => document.adoptedStyleSheets.map(sheet => [...sheet.cssRules].map(rule => rule.cssText))), [['body { margin: 24px; }']]);
  } finally { await browser.close(); }
});
