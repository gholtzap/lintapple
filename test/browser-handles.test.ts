import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JSHandle, Page, Locator } from 'playwright';
import { chromium } from 'playwright';
const { checkPage, checkInteractions } = await import(process.env.LINTAPPLE_PACKAGE || '../src/index.js') as typeof import('../src/index.js');

const html = `<html lang="en"><style>html{background:white;color:black;font:16px system-ui}button{font:inherit;margin:8px;padding:8px}</style><body>
<div id="tabs" role="tablist" aria-label="Views"><button id="tab" role="tab" aria-selected="true" aria-controls="panel">Overview</button></div>
<section id="panel" role="tabpanel" aria-labelledby="tab">Project overview</section></body></html>`;

test('page and widget checks release handles when later setup fails, then recover on the same page', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const evaluateHandle = page.evaluateHandle.bind(page) as (fn: unknown, argument?: unknown) => Promise<JSHandle<unknown>>;
    const plans = [
      () => checkPage(page),
      () => checkInteractions(page, { tabs: [{ selector: '#tabs', steps: [{ key: 'Home', focus: '#tab', selected: '#tab' }] }] }),
    ];
    for (const check of plans) for (const failAt of [2, 3, 4]) {
      const handles: JSHandle<unknown>[] = [];
      const disposed: JSHandle<unknown>[] = [];
      let attempts = 0;
      page.evaluateHandle = (async (fn: unknown, argument?: unknown) => {
        if (++attempts === failAt) throw new Error('Controlled browser setup failure');
        const handle = await evaluateHandle(fn, argument);
        handles.push(handle);
        const dispose = handle.dispose.bind(handle);
        handle.dispose = async () => { disposed.push(handle); await dispose(); };
        return handle;
      }) as Page['evaluateHandle'];
      try {
        await assert.rejects(check(), /Controlled browser setup failure/);
        assert.equal(handles.length, failAt - 1);
        assert.equal(disposed.length, handles.length, `Setup failure ${failAt} must release every acquired handle.`);
        assert.ok(handles.every(handle => disposed.includes(handle)));
        for (const handle of handles) await assert.rejects(handle.jsonValue());
      } finally { page.evaluateHandle = evaluateHandle as Page['evaluateHandle']; }
      assert.deepEqual((await check()).findings, []);
    }
  } finally { await browser.close(); }
});

test('a menu step releases its saved choices when creating the closing-menu handle fails', async t => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="menu" role="menubar" aria-label="Options"><button id="choice" role="menuitemcheckbox" aria-checked="false">Show notes</button></div>');
    await page.locator('#choice').focus();
    const prototype = Object.getPrototypeOf(page.locator('#menu')) as Locator;
    const original = prototype.evaluateHandle;
    let choices: JSHandle<unknown> | undefined;
    let disposed = false;
    t.mock.method(prototype, 'evaluateHandle', async function (this: Locator, ...args: Parameters<Locator['evaluateHandle']>) {
      const handle = await original.apply(this, args);
      choices = handle;
      const dispose = handle.dispose.bind(handle);
      handle.dispose = async () => { disposed = true; await dispose(); };
      return handle;
    });
    const evaluateHandle = page.evaluateHandle.bind(page) as (fn: unknown, argument?: unknown) => Promise<JSHandle<unknown>>;
    let attempts = 0;
    page.evaluateHandle = (async (fn: unknown, argument?: unknown) => {
      if (++attempts === 5) throw new Error('Controlled menu step failure');
      return evaluateHandle(fn, argument);
    }) as Page['evaluateHandle'];
    await assert.rejects(checkInteractions(page, { menus: [{ selector: '#menu', steps: [{ key: 'Tab', focus: '#choice' }] }] }), /Controlled menu step failure/);
    assert.ok(choices, 'The menu choices must be saved before the injected failure.');
    assert.equal(disposed, true);
    await assert.rejects(choices.jsonValue());
    assert.equal(await page.locator('#choice').textContent(), 'Show notes');
  } finally { await browser.close(); }
});
