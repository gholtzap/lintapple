import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';
import { html } from './audit-cases.js';

test('control sizes use inset clip paths on controls and ancestors', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const [clip, expected] of [['inset(30px)', '20 × 20px'], ['inset(37.5%)', '20 × 20px'], ['inset(10px 30px)', '20 × 60px'], ['inset(10px)', null], ['none', null]] as const) {
      for (const ancestor of [false, true]) {
        await page.setContent(html(`button{box-sizing:border-box;width:80px;height:80px;padding:0;border:0;margin:0}#clip{width:80px;height:80px;clip-path:${clip}}`, ancestor ? '<div id="clip"><button>Save</button></div>' : '<button id="clip">Save</button>'));
        const findings = (await checkPage(page, { minControlSize: 44 })).findings.filter(f => f.rule === 'control-size');
        assert.deepEqual(findings.map(f => f.actual), expected ? [expected] : []);
      }
    }
    await page.setContent(html('button{width:80px;height:80px;clip-path:circle(10px)}', '<button>Save</button>'));
    assert.ok((await checkPage(page)).findings.some(f => f.rule === 'control-size' && f.status === 'unresolved'));
  } finally { await browser.close(); }
});
