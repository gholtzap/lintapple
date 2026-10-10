import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const { checkPage, checkInteractions, defaultPolicy } = await import(process.env.LINTAPPLE_PACKAGE || '../src/index.js');
import { rules } from '../demo/rules.js';
import { createDemoServer } from '../demo/server.js';

test('demo before pages fail, fixes pass, and all routes and controls work', async () => {
  const server = process.env.LINTAPPLE_ORIGIN ? null : createDemoServer();
  if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.LINTAPPLE_ORIGIN || `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const examples = [];
  const shellChecks = [];
  const consoleErrors = [];
  page.on('pageerror', error => consoleErrors.push(error.message));
  const clean = async name => {
    const report = await checkPage(page);
    assert.deepEqual(report.findings, [], `${name}: ${JSON.stringify(report.findings)}`);
    shellChecks.push(name);
  };
  try {
    for (const viewport of [{ width: 248, height: 180 }, { width: 330, height: 200 }, ...defaultPolicy.viewports]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark']) for (const rule of rules) for (const state of ['before', 'after']) {
        await page.goto(`${origin}/demo/specimen.html?rule=${rule.id}&state=${state}&theme=${theme}`);
        await page.locator('body[data-ready="true"]').waitFor();
        const report = await checkPage(page);
        if (rule.interactions) {
          const interaction = await checkInteractions(page, rule.interactions);
          report.findings.push(...interaction.findings);
          report.interactionChecks = interaction.checks;
        }
        const name = `${rule.id}, ${state}, ${theme}, ${viewport.width}px`;
        if (state === 'before') assert.ok(report.findings.some(finding => finding.rule === rule.id), `${name} must fail its named rule: ${JSON.stringify(report.findings)}`);
        else assert.deepEqual(report.findings, [], `${name}: ${JSON.stringify(report.findings)}`);
        examples.push({ rule: rule.id, state, theme, viewport, ...report });
      }
    }
    await writeFile(new URL(process.env.LINTAPPLE_ORIGIN ? '../test-results/production-matrix.json' : '../demo/reports.json', import.meta.url), `${JSON.stringify({ command: process.env.LINTAPPLE_ORIGIN ? 'Production package and browser verification' : 'npm run demo:check', origin, policy: 'ui-policy.json', examples }, null, 2)}\n`);
    for (const viewport of [...defaultPolicy.viewports, { width: 768, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/demo/`);
      await page.getByText('Loading check results', { exact: true }).first().waitFor({ state: 'hidden' });
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.getByRole('button', { name: 'Copy the check command' }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'npm run demo:check');
      for (const theme of ['dark', 'light']) {
        if (theme === 'light') await page.getByRole('button', { name: 'Use light theme' }).click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        for (const src of await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame.getAttribute('src')))) assert.match(src, new RegExp(`theme=${theme}`));
        await clean(`Index before, ${theme}, ${viewport.width}px`);
        await page.getByRole('button', { name: 'Show all fixes', exact: true }).click();
        assert.equal(await page.locator('[data-state="after"][aria-pressed="true"]').count(), rules.length);
        await clean(`Index after, ${theme}, ${viewport.width}px`);
        for (const rule of rules) {
          const card = page.locator(`[data-rule="${rule.id}"]`);
          await card.getByRole('button', { name: 'Before', exact: true }).click();
          await card.locator('iframe').contentFrame().locator('body[data-ready="true"][data-state="before"]').waitFor();
          const identity = await card.locator('iframe').contentFrame().locator('body').evaluate(() => window.previewIdentity = crypto.randomUUID());
          assert.match(await card.locator('.finding-note').innerText(), /finding/);
          if (rule.id === 'content-clipping') {
            await card.locator('iframe').contentFrame().getByRole('slider', { name: 'Example width' }).press('Home');
            await card.locator('iframe').contentFrame().getByText('144 px', { exact: true }).waitFor();
          }
          await card.getByRole('button', { name: 'After', exact: true }).click();
          await card.locator('iframe').contentFrame().locator('body[data-ready="true"][data-state="after"]').waitFor();
          assert.equal(await card.locator('iframe').contentFrame().locator('body').evaluate(() => window.previewIdentity), identity, 'Changing state must keep the same preview document.');
          assert.equal(await card.locator('iframe').contentFrame().locator('body').evaluate(() => document.getAnimations().length), 0, 'Reduced-motion mode must not animate.');
          if (rule.id === 'content-clipping') await card.locator('iframe').contentFrame().getByText('144 px', { exact: true }).waitFor();
          assert.match(await card.locator('iframe').getAttribute('title'), /: after$/);
          assert.equal(await card.locator('.finding-note').innerText(), rule.id === 'content-clipping' ? 'At initial width: No findings' : 'No findings');
          await card.getByRole('link', { name: rule.title, exact: true }).click();
          await page.getByRole('heading', { name: rule.title, exact: true, level: 1 }).waitFor();
          assert.equal(await page.locator('iframe').count(), 2);
          for (const state of ['before', 'after']) await page.locator(`iframe[title$=": ${state}"]`).contentFrame().locator(`body[data-ready="true"][data-state="${state}"]`).waitFor();
          assert.ok(await page.locator('.report').count() > 0);
          await clean(`Detail ${rule.id}, ${theme}, ${viewport.width}px`);
          if (rule.id === 'content-clipping') {
            for (const state of ['before', 'after']) {
              const frame = page.frames().find(frame => frame.url().includes(`rule=content-clipping&state=${state}`));
              const panel = frame.locator('.resize-panel');
              const slider = frame.getByRole('slider', { name: 'Example width' });
              await panel.scrollIntoViewIfNeeded();
              const initial = await panel.boundingBox();
              await page.mouse.move(initial.x + initial.width - 3, initial.y + initial.height - 3);
              await page.mouse.down();
              await page.mouse.move(initial.x + initial.width + 80, initial.y + initial.height - 3, { steps: 10 });
              await page.mouse.up();
              assert.ok((await panel.boundingBox()).width > initial.width, 'Dragging the corner must increase the width.');
              await slider.press('Home');
              await frame.getByText('144 px', { exact: true }).waitFor();
              const narrow = await checkPage(frame);
              if (state === 'before') assert.ok(narrow.findings.some(finding => finding.rule === 'content-clipping'));
              else {
                assert.deepEqual(narrow.findings, []);
                assert.ok(await frame.locator('.project-name').evaluate(el => el.offsetHeight > parseFloat(getComputedStyle(el).lineHeight)), 'After text must wrap at the narrow width.');
              }
              await slider.press('End');
              await frame.waitForFunction(() => document.querySelector('#width-value').textContent === `${document.querySelector('#example-width').max} px`);
              const wide = await checkPage(frame);
              const clipped = await frame.locator('.project-name').evaluate(el => el.scrollWidth > el.clientWidth);
              if (state === 'before' && clipped) assert.ok(wide.findings.length && wide.findings.every(finding => finding.rule === 'content-clipping'), `The before label must report clipping when the font does not fit: ${JSON.stringify(wide.findings)}`);
              else assert.deepEqual(wide.findings, [], 'The complete label must fit at the largest width.');
              await clean(`Detail ${rule.id} resized ${state}, ${theme}, ${viewport.width}px`);
            }
          }
          await page.getByRole('link', { name: '← Index', exact: true }).click();
        }
        const themeControl = page.getByRole('button', { name: `Use ${theme === 'light' ? 'dark' : 'light'} theme` });
        await themeControl.hover();
        await clean(`Index hover, ${theme}, ${viewport.width}px`);
        await themeControl.focus();
        await clean(`Index focus, ${theme}, ${viewport.width}px`);
        if (viewport.width < 1024) {
          await page.locator('.mobile-nav summary').click();
          await clean(`Index open navigation, ${theme}, ${viewport.width}px`);
          await page.locator('.mobile-nav summary').click();
        }
        await page.getByRole('button', { name: 'Show all errors', exact: true }).click();
      }
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`${origin}/demo/`);
    await page.getByText('Loading check results', { exact: true }).first().waitFor({ state: 'hidden' });
    await page.locator('iframe').evaluateAll(frames => frames.forEach(frame => { frame.loading = 'eager'; }));
    for (const rule of rules) {
      const iframe = page.locator(`[data-rule="${rule.id}"] iframe`);
      await iframe.contentFrame().locator('body[data-ready="true"]').waitFor();
      await iframe.contentFrame().locator('body').evaluate(() => {
        window.previewIdentity = crypto.randomUUID();
        window.transitionCount = 0;
        const start = document.startViewTransition.bind(document);
        document.startViewTransition = update => { window.transitionCount++; return start(update); };
      });
    }
    const identities = await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame.contentWindow.previewIdentity));
    const sizeCard = page.locator('[data-rule="font-size"]');
    await sizeCard.getByRole('button', { name: 'After', exact: true }).click();
    const sizeFrame = await (await sizeCard.locator('iframe').elementHandle()).contentFrame();
    await sizeFrame.waitForFunction(() => document.getAnimations().length > 0);
    await sizeFrame.waitForFunction(() => document.getAnimations().length === 0);
    assert.equal(await sizeFrame.evaluate(() => window.transitionCount), 1);
    await page.evaluate(() => {
      document.querySelector('#all-states').click();
      document.querySelector('#all-states').click();
      document.querySelector('#all-states').click();
    });
    for (const rule of rules) await page.locator(`[data-rule="${rule.id}"] iframe`).contentFrame().locator('body[data-state="after"]').waitFor();
    assert.deepEqual(await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame.contentWindow.previewIdentity)), identities, 'Rapid global changes must keep every preview document.');
    await clean('Index animated after');
    await sizeFrame.evaluate(() => { document.startViewTransition = undefined; });
    await sizeCard.getByRole('button', { name: 'Before', exact: true }).click();
    await sizeFrame.locator('body[data-state="before"]').waitFor();
    assert.equal(await sizeFrame.evaluate(() => document.getAnimations().length), 0, 'The fallback must change state without animation.');
    await page.goto(`${origin}/demo/#/rule/unknown`);
    await page.getByRole('heading', { name: 'Rule not found' }).waitFor();
    await clean('Unknown rule');
    const blocked = await page.request.get(`${origin}/package.json`);
    assert.equal(blocked.status(), 404);
    assert.deepEqual(consoleErrors, []);
    console.log(`Checked ${examples.length} specimen states and ${shellChecks.length} page states. All after states pass. All before states show the expected rule.`);
  } finally {
    await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
