import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const { checkPage, defaultPolicy } = await import(process.env.LINTAPPLE_PACKAGE || '../src/index.js');
import { rules } from '../demo/rules.js';
import { createDemoServer } from '../demo/server.js';

test('demo examples report expected errors, fixes pass, and all routes and controls work', async () => {
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
    assert.doesNotMatch(await page.locator('main').innerText(), /\b(?:\d+ findings?|No findings)\b/);
    shellChecks.push(name);
  };
  try {
    for (const viewport of [{ width: 248, height: 180 }, { width: 330, height: 200 }, ...defaultPolicy.viewports]) {
      await page.setViewportSize(viewport);
      for (const theme of ['light', 'dark']) for (const rule of rules) for (const state of ['before', 'after']) {
        await page.goto(`${origin}/demo/specimen.html?rule=${rule.id}&state=${state}&theme=${theme}`);
        await page.locator('body[data-ready="true"]').waitFor();
        assert.equal((await page.locator('.specimen').boundingBox()).width, Math.min(224, viewport.width - 32), `${rule.id} must use the shared example width.`);
        const report = await checkPage(page);
        const name = `${rule.id}, ${state}, ${theme}, ${viewport.width}px`;
        if (state === 'before' && rule.id === 'content-overflow' && !await page.locator('.project-name').evaluate(el => el.scrollWidth > el.clientWidth)) assert.deepEqual(report.findings, [], `${name} must pass when the text fits.`);
        else if (state === 'before') assert.ok(report.findings.some(finding => finding.rule === rule.id), `${name} must fail its named rule: ${JSON.stringify(report.findings)}`);
        else assert.deepEqual(report.findings, [], `${name}: ${JSON.stringify(report.findings)}`);
        examples.push({ rule: rule.id, state, theme, viewport, ...report });
      }
    }
    await writeFile(new URL(process.env.LINTAPPLE_ORIGIN ? '../test-results/production-matrix.json' : '../demo/reports.json', import.meta.url), `${JSON.stringify({ command: process.env.LINTAPPLE_ORIGIN ? 'Production package and browser verification' : 'npm run demo:check', origin, policy: 'ui-policy.json', examples }, null, 2)}\n`);
    for (const viewport of [...defaultPolicy.viewports, { width: 768, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/demo/`);
      await page.locator('body[data-ready="true"]').waitFor();
      await page.getByRole('heading', { name: 'Index', level: 1, exact: true }).waitFor();
      assert.deepEqual(await page.locator('.intro pre').allTextContents(), [
        'npx lintapple http://localhost:3000',
        'npm install -D lintapple\nnpx lintapple init\nnpm run lint:ui',
        "import { expectUI } from 'lintapple/playwright';\nawait expectUI(page, testInfo);",
      ]);
      assert.equal(await page.getByRole('link', { name: 'View lintapple on GitHub' }).getAttribute('href'), 'https://github.com/gholtzap/lintapple');
      assert.equal(await page.locator('#all-states').count(), 0);
      assert.doesNotMatch(await page.locator('main').innerText(), /Start with the errors|Show all fixes|Show all errors/);
      if (await page.locator('html').getAttribute('data-theme') === 'light') await page.getByRole('button', { name: 'Use dark theme' }).click();
      assert.deepEqual(await page.locator('[data-rule]').evaluateAll(cards => cards.map(card => card.dataset.rule).sort()), rules.map(rule => rule.id).sort());
      const cardWidths = await page.locator('.rule-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().width));
      assert.ok(cardWidths.every(width => Math.abs(width - cardWidths[0]) < 1), 'All example cards must use the same grid width.');
      for (const theme of ['dark', 'light']) {
        if (theme === 'light') await page.getByRole('button', { name: 'Use light theme' }).click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
        for (const src of await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame.getAttribute('src')))) assert.match(src, new RegExp(`theme=${theme}`));
        await clean(`Index before, ${theme}, ${viewport.width}px`);
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
          assert.match(await card.locator('iframe').getAttribute('title'), /: after$/);
          await card.getByRole('link', { name: rule.title, exact: true }).click();
          await page.getByRole('heading', { name: rule.title, exact: true, level: 1 }).waitFor();
          assert.equal(await page.locator('iframe').count(), 1);
          const detail = page.locator('article.detail');
          const frame = await (await detail.locator('iframe').elementHandle()).contentFrame();
          await frame.locator('body[data-ready="true"]').waitFor();
          const detailIdentity = await frame.evaluate(() => window.previewIdentity = crypto.randomUUID());
          assert.equal(await page.locator('.report, .report-list, .finding-note, [data-copy]').count(), 0);
          assert.doesNotMatch(await detail.innerText(), /Before check results|Recorded at|Check this example|localhost:4173|Loading check results/);
          assert.equal(await detail.locator('.fix-code').innerText(), rule.fix);
          let controlRowHeight;
          for (const state of ['before', 'after']) {
            await detail.getByRole('button', { name: state === 'before' ? 'Before' : 'After', exact: true }).click();
            await frame.locator(`body[data-state="${state}"]`).waitFor();
            assert.equal(await frame.evaluate(() => window.previewIdentity), detailIdentity, 'Detail changes must keep the same preview document.');
            assert.equal(await detail.locator(`[data-state="${state}"]`).getAttribute('aria-pressed'), 'true');
            assert.equal(await detail.locator('[aria-pressed="true"]').count(), 1);
            assert.match(await detail.locator('iframe').getAttribute('title'), new RegExp(`: ${state}$`));
            if (rule.id === 'control-size') {
              const row = await frame.locator('.control-row').boundingBox();
              const button = await frame.locator('.remove-button').boundingBox();
              const icon = await frame.locator('.remove-button svg').boundingBox();
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
              const panel = frame.locator('.resize-panel');
              const slider = frame.getByRole('slider', { name: 'Example width' });
              assert.equal(await slider.inputValue(), await slider.getAttribute('max'), 'The slider must start at its maximum width.');
              await panel.scrollIntoViewIfNeeded();
              const initial = await panel.boundingBox();
              await page.mouse.move(initial.x + initial.width - 3, initial.y + initial.height - 3);
              await page.mouse.down();
              await page.mouse.move(initial.x + initial.width - 80, initial.y + initial.height - 3, { steps: 10 });
              await page.mouse.up();
              assert.ok((await panel.boundingBox()).width < initial.width, 'Dragging the corner left must reduce the width.');
              await slider.press('Home');
              await frame.getByText('144 px', { exact: true }).waitFor();
              const narrow = await checkPage(frame);
              if (state === 'before') assert.ok(narrow.findings.some(finding => finding.rule === 'content-overflow'));
              else {
                assert.deepEqual(narrow.findings, []);
                assert.ok(await frame.locator('.project-name').evaluate(el => el.offsetHeight > parseFloat(getComputedStyle(el).lineHeight)), 'After text must wrap at the narrow width.');
              }
              await slider.press('End');
              await frame.waitForFunction(() => document.querySelector('#width-value').textContent === `${document.querySelector('#example-width').max} px`);
              if (state === 'after') assert.deepEqual((await checkPage(frame)).findings, [], 'After must show the complete label at the largest width.');
              await clean(`Detail ${rule.id} resized ${state}, ${theme}, ${viewport.width}px`);
            }
          }
          await page.locator('.back-link').click();
          await page.getByRole('heading', { name: 'Index', level: 1, exact: true }).waitFor();
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
        await page.locator('[data-rule] [data-state="before"]').evaluateAll(buttons => buttons.forEach(button => button.click()));
      }
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`${origin}/demo/`);
    await page.locator('body[data-ready="true"]').waitFor();
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
      document.querySelectorAll('[data-rule]').forEach(example => {
        for (const state of ['before', 'after', 'before', 'after']) example.querySelector(`[data-state="${state}"]`).click();
      });
    });
    for (const rule of rules) await page.locator(`[data-rule="${rule.id}"] iframe`).contentFrame().locator('body[data-state="after"]').waitFor();
    assert.deepEqual(await page.locator('iframe').evaluateAll(frames => frames.map(frame => frame.contentWindow.previewIdentity)), identities, 'Rapid changes must keep every preview document.');
    await clean('Index animated after');
    await sizeFrame.evaluate(() => { document.startViewTransition = undefined; });
    await sizeCard.getByRole('button', { name: 'Before', exact: true }).click();
    await sizeFrame.locator('body[data-state="before"]').waitFor();
    assert.equal(await sizeFrame.evaluate(() => document.getAnimations().length), 0, 'The fallback must change state without animation.');
    await page.goto(`${origin}/demo/#/accessibility`);
    await page.getByRole('heading', { name: 'Index', level: 1, exact: true }).waitFor();
    assert.equal(await page.locator('a[href="#/accessibility"]').count(), 0);
    await clean('Removed accessibility page returns to Index');
    await page.goto(`${origin}/demo/#/rule/content-clipping`);
    await page.getByRole('heading', { name: 'Contained text', level: 1, exact: true }).waitFor();
    await clean('Old text demo link opens the overflow example');
    for (const id of ['accessible-name', 'form-label']) {
      await page.goto(`${origin}/demo/#/rule/${id}`);
      await page.getByRole('heading', { name: 'Rule not found' }).waitFor();
      await clean(`Removed accessibility rule: ${id}`);
    }
    await page.goto(`${origin}/demo/#/rule/unknown`);
    await page.getByRole('heading', { name: 'Rule not found' }).waitFor();
    await clean('Unknown rule');
    const blocked = await page.request.get(`${origin}/package.json`);
    assert.equal(blocked.status(), 404);
    assert.deepEqual(consoleErrors, []);
    console.log(`Checked ${examples.length} specimen states and ${shellChecks.length} page states. All after states pass. Before states match the expected results.`);
  } finally {
    await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
});

test('Lenis smooths wheel scrolling, respects motion changes, and resets rule navigation', async () => {
  const server = process.env.LINTAPPLE_ORIGIN ? null : createDemoServer();
  if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = process.env.LINTAPPLE_ORIGIN || `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  try {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${origin}/demo/`);
      await page.locator('body[data-ready="true"]').waitFor();
      await page.locator('html.lenis').waitFor();
      for (const reducedMotion of ['no-preference', 'reduce', 'no-preference']) {
        await page.emulateMedia({ reducedMotion });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForFunction(() => scrollY === 0);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.evaluate(() => {
          window.scrollSamples = [];
          window.sampleScroll = true;
          const sample = () => {
            window.scrollSamples.push(scrollY);
            if (window.sampleScroll) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        const heading = await page.getByRole('heading', { name: 'Index', level: 1, exact: true }).boundingBox();
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
      await page.goto(`${origin}/demo/#/rule/content-overflow`);
      await page.getByRole('heading', { name: 'Contained text', level: 1, exact: true }).waitFor();
      await page.locator('body[data-ready="true"]').waitFor();
      await page.mouse.move(width - 16, 200);
      await page.mouse.wheel(0, 300);
      await page.waitForFunction(() => scrollY > 0 && document.documentElement.classList.contains('lenis-smooth'));
      await page.locator('.brand').click();
      await page.getByRole('heading', { name: 'Index', level: 1, exact: true }).waitFor();
      await page.waitForFunction(() => scrollY === 0 && !document.documentElement.classList.contains('lenis-scrolling'));
      assert.deepEqual(await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(scrollY))))), 0);
    }
    await page.setViewportSize({ width: 1440, height: 500 });
    const sidebar = page.locator('.sidebar');
    const box = await sidebar.boundingBox();
    await page.mouse.move(box.x + 16, box.y + 16);
    await page.mouse.wheel(0, 200);
    await page.waitForFunction(() => document.querySelector('.sidebar').scrollTop > 0);
    assert.equal(await page.evaluate(() => scrollY), 0, 'Sidebar scrolling must not move the page.');
    for (const name of ['lenis.mjs', 'lenis.css']) {
      const asset = await page.request.get(`${origin}/demo/vendor/${name}`);
      assert.equal(asset.status(), 200);
      assert.match(asset.headers()['content-type'], name.endsWith('.css') ? /text\/css/ : /javascript/);
    }
    assert.equal((await page.request.get(`${origin}/node_modules/lenis/package.json`)).status(), 404);
  } finally {
    await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
});
