import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';

test('popup reference review is resolved only for unique menu targets', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const shell = (content: string) => `<html lang="en"><style>html{font:16px system-ui;background:white;color:black}button{font:inherit;min-height:32px;margin:8px}</style><body>${content}</body></html>`;
    for (const expanded of ['true', 'false']) {
      await page.setContent(shell(`<button aria-haspopup="menu" aria-expanded="${expanded}" aria-controls="menu">Actions</button><div id="menu" role="menu" ${expanded === 'false' ? 'hidden' : ''}><button role="menuitem">Save</button></div>`));
      const result = await checkPage(page);
      assert.deepEqual(result.findings, [], JSON.stringify(result.findings));
    }
    for (const content of [
      '<button aria-haspopup="menu" aria-expanded="false" aria-controls="missing">Actions</button>',
      '<button aria-haspopup="menu" aria-expanded="true" aria-controls="menu">Actions</button><div id="menu" role="menu"><button role="menuitem">Save</button></div><div id="menu" role="menu"><button role="menuitem">Close</button></div>',
      '<button aria-haspopup="menu" aria-expanded="true" aria-controls="menu">Actions</button><div id="menu">Unrelated content</div>',
    ]) {
      await page.setContent(shell(content));
      const result = await checkPage(page);
      assert.ok(result.findings.some(f => f.rule === 'control-state' && f.status === 'unresolved'), JSON.stringify(result.findings));
    }
    await page.setContent(shell('<button aria-haspopup="menu" aria-expanded="wrong" aria-controls="menu">Actions</button><div id="menu" role="menu"><button role="menuitem">Save</button></div>'));
    assert.ok((await checkPage(page)).findings.some(f => f.rule === 'control-state' && f.status === 'failed'));
  } finally { await browser.close(); }
});
