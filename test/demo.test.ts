import type { AddressInfo } from 'node:net';
import type { PageReport, Policy } from '../src/types.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const { checkPage, defaultPolicy } = await import(process.env.LINTAPPLE_PACKAGE || '../src/index.js') as typeof import('../src/index.js');
import { rules } from '../demo/rules.js';
import { createDemoServer } from '../demo/server.js';
const policy: Policy = JSON.parse(await readFile(new URL('../ui-policy.json', import.meta.url), 'utf8'));

test('demo examples report expected errors, fixes pass, and all routes and controls work', async () => {
  const server = process.env.LINTAPPLE_ORIGIN ? null : createDemoServer();
  if (server) await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.LINTAPPLE_ORIGIN || `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const examples: (PageReport & {rule: string; state: string; theme: string; viewport: {width: number; height: number}; interaction?: string})[] = [];
  const shellChecks: (PageReport & { name: string })[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => consoleErrors.push(error.message));
  const clean = async (name: string) => {
    const report = await checkPage(page, policy);
    shellChecks.push({ name, ...report });
    await mkdir(new URL('../../test-results/', import.meta.url), { recursive: true });
    await writeFile(new URL('../../test-results/demo-ui.json', import.meta.url), JSON.stringify(shellChecks, null, 2));
    assert.deepEqual(report.findings, [], `${name}: ${JSON.stringify(report.findings)}`);
    assert.doesNotMatch(await page.locator('main').innerText(), /\b(?:\d+ findings?|No findings)\b/);
  };
  try {
    for (const viewport of [{ width: 248, height: 180 }, { width: 330, height: 200 }, ...defaultPolicy.viewports]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark'] as const) for (const rule of rules) for (const state of ['before', 'after']) {
        await page.goto(`${origin}/demo/specimen.html?rule=${rule.id}&state=${state}&theme=${theme}`);
        await page.locator('body[data-ready="true"]').waitFor();
        assert.equal((await page.locator('.specimen').boundingBox())!.width, Math.min(224, viewport.width - 32), `${rule.id} must use the shared example width.`);
        if (rule.id === 'viewport-bounds') await page.getByRole('link', { name: 'Download', exact: true }).hover();
        const report = await checkPage(page);
        const name = `${rule.id}, ${state}, ${theme}, ${viewport.width}px`;
        if (state === 'before' && rule.id === 'content-overflow' && !await page.locator('.project-name').evaluate(el => el.scrollWidth > el.clientWidth)) assert.deepEqual(report.findings, [], `${name} must pass when the text fits.`);
        else if (state === 'before') assert.ok(report.findings.some(finding => finding.rule === rule.id), `${name} must fail its named rule: ${JSON.stringify(report.findings)}`);
        else assert.deepEqual(report.findings, [], `${name}: ${JSON.stringify(report.findings)}`);
        examples.push({ rule: rule.id, state, theme, viewport, ...report });
        if (rule.id === 'viewport-bounds') {
          await page.keyboard.press('Escape');
          assert.equal(await page.getByRole('tooltip').isVisible(), false);
          if (state === 'after') {
            await page.mouse.move(-1, -1);
            await page.keyboard.press('Tab');
            await page.getByRole('tooltip').waitFor();
            const focused = await checkPage(page, policy);
            assert.deepEqual(focused.findings, []);
            examples.push({ rule: rule.id, state, interaction: 'focus', theme, viewport, ...focused });
            if (viewport.width === 390 && theme === 'light') {
              const narrow = { width: 248, height: 180 };
              await page.setViewportSize(narrow);
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              const resized = await checkPage(page, policy);
              assert.deepEqual(resized.findings, []);
              examples.push({ rule: rule.id, state, interaction: 'resize', theme, viewport: narrow, ...resized });
              await page.setViewportSize(viewport);
            }
          }
        }
        if (rule.id === 'control-size') {
          await mkdir(new URL('../../test-results/', import.meta.url), { recursive: true });
          if (state === 'after' && viewport.width >= 390) await page.screenshot({ path: new URL(`../test-results/button-surface-${theme}-${viewport.width}.jpg`, import.meta.url).pathname });
          const button = page.getByRole('button', { name: 'Remove file' });
          for (const interaction of ['hover', 'focus']) {
            if (interaction === 'hover') await button.hover();
            else await button.focus();
            const checked = await checkPage(page, policy);
            assert.deepEqual(checked.findings.map(finding => finding.rule).sort(), report.findings.map(finding => finding.rule).sort(), `${name}, ${interaction}`);
            examples.push({ rule: rule.id, state, interaction, theme, viewport, ...checked });
          }
        }
      }
    }
    await writeFile(new URL(process.env.LINTAPPLE_ORIGIN ? '../../test-results/production-matrix.json' : '../demo/reports.json', import.meta.url), `${JSON.stringify({ command: process.env.LINTAPPLE_ORIGIN ? 'Production package and browser verification' : 'npm run demo:check', origin, policy: 'ui-policy.json', examples }, null, 2)}\n`);
    await writeFile(new URL('../../test-results/demo-specimens.json', import.meta.url), JSON.stringify(examples, null, 2));
    for (const viewport of [...defaultPolicy.viewports, { width: 768, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/demo/`);
      await page.locator('body[data-ready="true"]').waitFor();
      await page.getByRole('heading', { name: 'About', level: 1, exact: true }).waitFor();
      assert.deepEqual(await page.locator('.intro pre').allTextContents(), [
        'npm install -D lintapple && npx lintapple init',
      ]);
      assert.equal(await page.locator('.intro p.fix-code').innerText(), 'Install and set up github.com/gholtzap/lintapple in this project. Configure it for this app’s URL, fonts, and text sizes.');
      assert.equal(await page.getByRole('link', { name: 'View lintapple on GitHub' }).getAttribute('href'), 'https://github.com/gholtzap/lintapple');
      assert.equal(await page.locator('#all-states').count(), 0);
      assert.doesNotMatch(await page.locator('main').innerText(), /Start with the errors|Show all fixes|Show all errors/);
      if (await page.locator('html').getAttribute('data-theme') === 'light') await page.getByRole('button', { name: 'Use dark theme' }).click();
      assert.deepEqual(await page.locator('[data-rule]').evaluateAll(cards => cards.map(card => card.dataset.rule).sort()), rules.map(rule => rule.id).sort());
      const cardWidths = await page.locator('.rule-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().width));
      assert.ok(cardWidths.every(width => Math.abs(width - cardWidths[0]) < 1), 'All example cards must use the same grid width.');
      assert.equal(await page.locator('.site-header').evaluate(el => getComputedStyle(el).position), 'static');
      assert.equal((await page.locator('.site-header').boundingBox())!.height, 64);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      for (const theme of ['dark', 'light']) {
        if (theme === 'light') await page.getByRole('button', { name: 'Use light theme' }).click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        for (const src of await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame!.getAttribute('src')))) assert.match(src!, new RegExp(`theme=${theme}`));
        const tooltipCard = page.locator('[data-rule="viewport-bounds"]');
        const initialTooltip = tooltipCard.locator('iframe').contentFrame().getByRole('tooltip');
        await tooltipCard.scrollIntoViewIfNeeded();
        await initialTooltip.waitFor();
        assert.ok(await initialTooltip.evaluate(el => el.getBoundingClientRect().left < 0), 'The gallery must show Before without a preview click or hover.');
        await page.keyboard.press('Escape');
        assert.equal(await initialTooltip.isVisible(), false);
        await page.evaluate(() => window.scrollTo(0, 0));
        await clean(`Index before, ${theme}, ${viewport.width}px`);
        const about = page.locator('.sidebar nav > a');
        assert.equal(await about.getAttribute('aria-current'), 'page');
        assert.equal(await about.evaluate(el => getComputedStyle(el).fontWeight), '600');
        const copy = page.getByRole('button', { name: 'Copy', exact: true });
        assert.equal(await copy.locator('svg[aria-hidden="true"]').count(), 1);
        const codeBox = (await page.locator('.command-code').boundingBox())!;
        const copyBox = (await copy.boundingBox())!;
        assert.ok(copyBox.x >= codeBox.x && copyBox.x + copyBox.width <= codeBox.x + codeBox.width && copyBox.y >= codeBox.y && copyBox.y + copyBox.height <= codeBox.y + codeBox.height, 'Copy must stay inside the command block.');
        await copy.click();
        await page.getByRole('status').getByText('Copied', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'npm install -D lintapple && npx lintapple init');
        await clean(`Copy success, ${theme}, ${viewport.width}px`);
        await page.screenshot({ path: new URL(`../test-results/demo-about-${theme}-${viewport.width}.jpg`, import.meta.url).pathname });
        await page.evaluate(() => { window.writeText = navigator.clipboard.writeText; navigator.clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); }; });
        await copy.click();
        await page.getByRole('status').getByText('Could not copy. Select the command to copy it.', { exact: true }).waitFor();
        assert.equal(await copy.isEnabled(), true);
        await clean(`Copy error, ${theme}, ${viewport.width}px`);
        await page.evaluate(() => { navigator.clipboard.writeText = window.writeText; });
        await copy.focus();
        await page.keyboard.press('Enter');
        await page.getByRole('status').getByText('Copied', { exact: true }).waitFor();
        await clean(`Copy keyboard focus, ${theme}, ${viewport.width}px`);
        await copy.hover();
        await page.getByRole('tooltip', { name: 'Copy', exact: true }).waitFor();
        await clean(`Copy hover, ${theme}, ${viewport.width}px`);
        await page.keyboard.press('Escape');
        await page.getByRole('tooltip', { name: 'Copy', exact: true }).waitFor({ state: 'hidden' });
        const gaps = await page.locator('[data-rule="tabular-numbers"]').evaluate(card => {
          const rect = (selector: string) => card.querySelector(selector)!.getBoundingClientRect();
          return [rect('h3').top - rect('iframe').bottom, rect('.card-copy p').top - rect('h3').bottom, rect('.state-controls').top - rect('.card-copy p').bottom];
        });
        assert.deepEqual(gaps, [24, 8, 16]);
        for (const rule of rules) {
          const card = page.locator(`[data-rule="${rule.id}"]`);
          await card.getByRole('button', { name: 'Before', exact: true }).click();
          await card.locator('iframe').contentFrame().locator('body[data-ready="true"][data-state="before"]').waitFor();
          const identity = await card.locator('iframe').contentFrame().locator('body').evaluate(() => window.previewIdentity = crypto.randomUUID());
          if (rule.id === 'content-overflow') {
            await card.locator('iframe').contentFrame().getByRole('slider', { name: 'Example width' }).press('Home');
            await card.locator('iframe').contentFrame().getByText('144 px', { exact: true }).waitFor();
          }
          await card.getByRole('button', { name: 'After', exact: true }).click();
          await card.locator('iframe').contentFrame().locator('body[data-ready="true"][data-state="after"]').waitFor();
          assert.equal(await card.locator('iframe').contentFrame().locator('body').evaluate(() => window.previewIdentity), identity, 'Changing state must keep the same preview document.');
          assert.equal(await card.locator('iframe').contentFrame().locator('body').evaluate(() => document.getAnimations().length), 0, 'Reduced-motion mode must not animate.');
          if (rule.id === 'content-overflow') await card.locator('iframe').contentFrame().getByText('144 px', { exact: true }).waitFor();
          assert.match((await card.locator('iframe').getAttribute('title'))!, /: after$/);
          await card.getByRole('link', { name: rule.title, exact: true }).click();
          await page.getByRole('heading', { name: rule.title, exact: true, level: 1 }).waitFor();
          assert.equal(await page.locator('iframe').count(), 1);
          assert.ok(new URL(page.url()).pathname.endsWith(`/rule/${rule.id}`));
          assert.equal(new URL(page.url()).hash, '');
          const detail = page.locator('article.detail');
          const frame = await (await detail.locator('iframe').elementHandle())!.contentFrame();
          await frame!.locator('body[data-ready="true"]').waitFor();
          if (rule.id === 'viewport-bounds') {
            await frame!.getByRole('tooltip').waitFor();
            await frame!.locator('.label').hover();
            await frame!.locator('.specimen').hover({ position: { x: 1, y: 1 } });
            assert.equal(await frame!.getByRole('tooltip').isVisible(), true, 'Pointer movement outside the tooltip and its trigger must keep the preview open.');
          }
          const detailIdentity = await frame!.evaluate(() => window.previewIdentity = crypto.randomUUID());
          assert.equal(await page.locator('.report, .report-list, .finding-note, [data-copy]').count(), 0);
          assert.doesNotMatch(await detail.innerText(), /Before check results|Recorded at|Check this example|localhost:4173|Loading check results/);
          assert.equal(await detail.locator('.fix-code').innerText(), rule.fix);
          assert.ok(await detail.locator('.shiki span[style]').count() > 0, 'Fix code must have syntax colors.');
          assert.equal(await page.locator('.sidebar nav > a').evaluate(el => getComputedStyle(el).fontWeight), '400');
          if (rule.id === 'tabular-numbers') await page.screenshot({ path: new URL(`../test-results/demo-detail-${theme}-${viewport.width}.jpg`, import.meta.url).pathname });
          let controlRowHeight: number | undefined;
          for (const state of ['before', 'after']) {
            await detail.getByRole('button', { name: state === 'before' ? 'Before' : 'After', exact: true }).click();
            await frame!.locator(`body[data-state="${state}"]`).waitFor();
            assert.equal(await frame!.evaluate(() => window.previewIdentity), detailIdentity, 'Detail changes must keep the same preview document.');
            assert.equal(await detail.locator(`[data-state="${state}"]`).getAttribute('aria-pressed'), 'true');
            assert.equal(await detail.locator('[aria-pressed="true"]').count(), 1);
            assert.match((await detail.locator('iframe').getAttribute('title'))!, new RegExp(`: ${state}$`));
            if (rule.id === 'viewport-bounds') {
              const tooltip = frame!.getByRole('tooltip');
              await tooltip.waitFor();
              const left = await tooltip.evaluate(el => el.getBoundingClientRect().left);
              assert.ok(state === 'before' ? left < 0 : left >= 0, 'The tooltip must show the selected state without hover.');
              assert.equal(await frame!.locator('.tooltip-example').evaluate(el => el.getBoundingClientRect().left), 16);
              const toggle = detail.getByRole('button', { name: state === 'before' ? 'Before' : 'After', exact: true });
              await toggle.press('Escape');
              assert.equal(await tooltip.isVisible(), false);
              await toggle.click();
              await tooltip.waitFor();
            }
            if (rule.id === 'content-inset' && state === 'after') {
              const summary = frame!.locator('summary');
              await summary.press('Enter');
              await frame!.getByRole('button', { name: 'Documents', exact: true }).click();
              assert.equal(await summary.innerText(), 'Documents');
              assert.equal(await frame!.locator('details').getAttribute('open'), null);
              await summary.press('Enter');
              assert.deepEqual((await checkPage(frame!, policy)).findings, []);
              await summary.press('Escape');
              assert.equal(await frame!.locator('details').getAttribute('open'), null);
              const center = await frame!.locator('.product').evaluate(el => {
                const box = el.getBoundingClientRect();
                return { x: box.left + box.width / 2 - innerWidth / 2, y: box.top + box.height / 2 - innerHeight / 2 };
              });
              assert.ok(Math.abs(center.x) < 1 && Math.abs(center.y) < 1, 'The closed dropdown example must stay centered.');
            }
            if (rule.id === 'control-size') {
              const row = (await frame!.locator('.control-row').boundingBox())!;
              const button = (await frame!.locator('.remove-button').boundingBox())!;
              const icon = (await frame!.locator('.remove-button svg').boundingBox())!;
              assert.ok(Math.abs(icon.x + icon.width / 2 - button.x - button.width / 2) < 0.5, 'The icon must be centered horizontally.');
              assert.ok(Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2) < 0.5, 'The icon must be centered vertically.');
              assert.ok(icon.width <= button.width && icon.height <= button.height, 'The icon must fit inside the button.');
              if (state === 'before') controlRowHeight = row.height;
              else {
                assert.equal(row.height, controlRowHeight, 'The file row must keep its height when the control size changes.');
                assert.equal(icon.width, 16);
                assert.equal(icon.height, 16);
              }
            }
            await clean(`Detail ${rule.id} ${state}, ${theme}, ${viewport.width}px`);
            if (rule.id === 'content-overflow') {
              const panel = frame!.locator('.resize-panel');
              const slider = frame!.getByRole('slider', { name: 'Example width' });
              assert.equal(await slider.inputValue(), await slider.getAttribute('max'), 'The slider must start at its maximum width.');
              await panel.scrollIntoViewIfNeeded();
              const initial = (await panel.boundingBox())!;
              await page.mouse.move(initial.x + initial.width - 3, initial.y + initial.height - 3);
              await page.mouse.down();
              await page.mouse.move(initial.x + initial.width - 80, initial.y + initial.height - 3, { steps: 10 });
              await page.mouse.up();
              assert.ok((await panel.boundingBox())!.width < initial.width, 'Dragging the corner left must reduce the width.');
              await slider.press('Home');
              await frame!.getByText('144 px', { exact: true }).waitFor();
              const narrow = await checkPage(frame!);
              if (state === 'before') assert.ok(narrow.findings.some(finding => finding.rule === 'content-overflow'));
              else {
                assert.deepEqual(narrow.findings, []);
                assert.ok(await frame!.locator('.project-name').evaluate(el => (el as HTMLElement).offsetHeight > parseFloat(getComputedStyle(el).lineHeight)), 'After text must wrap at the narrow width.');
              }
              await slider.press('End');
              await frame!.waitForFunction(() => document.querySelector('#width-value')!.textContent === `${document.querySelector<HTMLInputElement>('#example-width')!.max} px`);
              if (state === 'after') assert.deepEqual((await checkPage(frame!)).findings, [], 'After must show the complete label at the largest width.');
              await clean(`Detail ${rule.id} resized ${state}, ${theme}, ${viewport.width}px`);
            }
          }
          await page.locator('.back-link').click();
          await page.getByRole('heading', { name: 'About', level: 1, exact: true }).waitFor();
        }
        assert.equal(await page.locator('[data-state="after"][aria-pressed="true"]').count(), rules.length);
        await clean(`Index after, ${theme}, ${viewport.width}px`);
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
        await page.locator('[data-rule] [data-state="before"]').evaluateAll(buttons => buttons.forEach(button => (button as HTMLElement).click()));
      }
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`${origin}/demo/`);
    await page.locator('body[data-ready="true"]').waitFor();
    await page.locator('iframe').evaluateAll(frames => frames.forEach(frame => { (frame as HTMLIFrameElement).loading = 'eager'; }));
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
    const identities = await page.locator('iframe').evaluateAll(frames => frames.map(frame => (frame as HTMLIFrameElement).contentWindow!.previewIdentity));
    const sizeCard = page.locator('[data-rule="font-size"]');
    await sizeCard.getByRole('button', { name: 'After', exact: true }).click();
    const sizeFrame = await (await sizeCard.locator('iframe').elementHandle()).contentFrame();
    await sizeFrame!.waitForFunction(() => document.getAnimations().length > 0);
    await sizeFrame!.waitForFunction(() => document.getAnimations().length === 0);
    assert.equal(await sizeFrame!.evaluate(() => window.transitionCount), 1);
    await page.evaluate(() => {
      document.querySelectorAll('[data-rule]').forEach(example => {
        for (const state of ['before', 'after', 'before', 'after']) example.querySelector<HTMLElement>(`[data-state="${state}"]`)!.click();
      });
    });
    for (const rule of rules) await page.locator(`[data-rule="${rule.id}"] iframe`).contentFrame().locator('body[data-state="after"]').waitFor();
    assert.deepEqual(await page.locator('iframe').evaluateAll(frames => frames.map(frame => (frame as HTMLIFrameElement).contentWindow!.previewIdentity)), identities, 'Rapid changes must keep every preview document.');
    await clean('Index animated after');
    await sizeFrame!.evaluate(() => { Reflect.deleteProperty(document, 'startViewTransition'); Object.defineProperty(document, 'startViewTransition', { value: undefined, configurable: true }); });
    await sizeCard.getByRole('button', { name: 'Before', exact: true }).click();
    await sizeFrame!.locator('body[data-state="before"]').waitFor();
    assert.equal(await sizeFrame!.evaluate(() => document.getAnimations().length), 0, 'The fallback must change state without animation.');
    await page.goto(`${origin}/demo/#/accessibility`);
    await page.getByRole('heading', { name: 'About', level: 1, exact: true }).waitFor();
    assert.equal(await page.locator('a[href="#/accessibility"]').count(), 0);
    await clean('Removed accessibility page returns to Index');
    await page.goto(`${origin}/demo/#/rule/content-clipping`);
    await page.getByRole('heading', { name: 'Contained text', level: 1, exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, '');
    assert.ok(new URL(page.url()).pathname.endsWith('/rule/content-clipping'));
    await clean('Old text demo link opens the overflow example');
    for (const id of ['accessible-name', 'form-label']) {
      await page.goto(`${origin}/demo/rule/${id}`);
      await page.getByRole('heading', { name: 'Rule not found' }).waitFor();
      await clean(`Removed accessibility rule: ${id}`);
    }
    await page.goto(`${origin}/demo/rule/unknown`);
    await page.getByRole('heading', { name: 'Rule not found' }).waitFor();
    await clean('Unknown rule');
    const blocked: import('playwright').APIResponse<unknown> = await page.request.get(`${origin}/package.json`);
    assert.equal(blocked.status(), 404);
    assert.deepEqual(consoleErrors, []);
    console.log(`Checked ${examples.length} specimen states and ${shellChecks.length} page states. All after states pass. Before states match the expected results.`);
  } finally {
    await browser.close();
    if (server) await new Promise<void>((resolve, reject: (reason?: unknown) => void) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('Lenis smooths wheel scrolling, respects motion changes, and resets rule navigation', async () => {
  const server = process.env.LINTAPPLE_ORIGIN ? null : createDemoServer();
  if (server) await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.LINTAPPLE_ORIGIN || `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  try {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${origin}/demo/`);
      await page.locator('body[data-ready="true"]').waitFor();
      await page.locator('html.lenis').waitFor();
      for (const reducedMotion of ['no-preference', 'reduce', 'no-preference'] as const) {
        await page.emulateMedia({ reducedMotion });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForFunction(() => scrollY === 0);
        await page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.evaluate(() => {
          window.scrollSamples = [];
          window.sampleScroll = true;
          const sample = () => {
            window.scrollSamples.push(scrollY);
            if (window.sampleScroll) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        const heading = (await page.getByRole('heading', { name: 'About', level: 1, exact: true }).boundingBox())!;
        await page.mouse.move(heading.x + 8, heading.y + 8);
        await page.mouse.wheel(0, 600);
        await page.waitForFunction(() => scrollY > 0 && !document.documentElement.classList.contains('lenis-scrolling'));
        const samples = await page.evaluate(() => { window.sampleScroll = false; return window.scrollSamples; });
        const intermediate = new Set(samples.filter(value => value > 0 && value < 599));
        if (reducedMotion === 'reduce') assert.equal(intermediate.size, 0, 'Reduced motion must scroll without intermediate positions.');
        else assert.ok(intermediate.size > 2, 'Normal wheel scrolling must move across several frames.');
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.keyboard.press('PageDown');
      await page.waitForFunction(() => scrollY > 0 && !document.documentElement.classList.contains('lenis-scrolling'));
      await page.keyboard.press('PageUp');
      await page.waitForFunction(() => scrollY === 0 && !document.documentElement.classList.contains('lenis-scrolling'));
      await page.goto(`${origin}/demo/rule/content-overflow`);
      await page.getByRole('heading', { name: 'Contained text', level: 1, exact: true }).waitFor();
      await page.locator('body[data-ready="true"]').waitFor();
      await page.mouse.move(width - 16, 200);
      await page.mouse.wheel(0, 300);
      await page.waitForFunction(() => scrollY > 0 && document.documentElement.classList.contains('lenis-smooth'));
      await page.locator('.back-link').click();
      await page.getByRole('heading', { name: 'About', level: 1, exact: true }).waitFor();
      await page.waitForFunction(() => scrollY === 0 && !document.documentElement.classList.contains('lenis-scrolling'));
      assert.deepEqual(await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(scrollY))))), 0);
      const home = page.url();
      for (const rule of rules) {
        await page.goto(new URL(`rule/${rule.id}`, home).href);
        await page.getByRole('heading', { name: rule.title, level: 1, exact: true }).waitFor();
        await page.locator('iframe').contentFrame().locator('body[data-ready="true"]').waitFor();
        await page.reload();
        await page.getByRole('heading', { name: rule.title, level: 1, exact: true }).waitFor();
        await page.locator('.back-link').click();
        await page.getByRole('heading', { name: 'About', level: 1, exact: true }).waitFor();
        await page.goBack();
        await page.getByRole('heading', { name: rule.title, level: 1, exact: true }).waitFor();
        await page.goForward();
        await page.getByRole('heading', { name: 'About', level: 1, exact: true }).waitFor();
        await page.goto(`${home}#/rule/${rule.id}`);
        await page.getByRole('heading', { name: rule.title, level: 1, exact: true }).waitFor();
        assert.equal(page.url(), new URL(`rule/${rule.id}`, home).href);
        await page.locator('.back-link').click();
      }
      assert.equal((await page.request.get(new URL('missing.js', home).href)).status(), 404);
      assert.equal((await page.request.get(new URL('rule/unknown/extra', home).href)).status(), 404);

    }
    await page.setViewportSize({ width: 1440, height: 500 });
    const sidebar = page.locator('.sidebar');
    const box = (await sidebar.boundingBox())!;
    await page.mouse.move(box.x + 16, box.y + 16);
    await page.mouse.wheel(0, 200);
    await page.waitForFunction(() => document.querySelector('.sidebar')!.scrollTop > 0);
    assert.equal(await page.evaluate(() => scrollY), 0, 'Sidebar scrolling must not move the page.');
    for (const name of ['lenis.mjs', 'lenis.css']) {
      const asset: import('playwright').APIResponse<unknown> = await page.request.get(`${origin}/demo/vendor/${name}`);
      assert.equal(asset.status(), 200);
      assert.match(asset.headers()['content-type'], name.endsWith('.css') ? /text\/css/ : /javascript/);
    }
    assert.equal((await page.request.get(`${origin}/node_modules/lenis/package.json`)).status(), 404);
  } finally {
    await browser.close();
    if (server) await new Promise<void>((resolve, reject: (reason?: unknown) => void) => server.close(error => error ? reject(error) : resolve()));
  }
});
