import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage, validatePolicy } from '../src/index.js';

const policy = { fullImageSelectors: ['.preview img'] };
const art = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="320"><rect width="120" height="320" fill="blue"/></svg>',
);
const fixture = (preview: string, image: string, src = art) => `<!doctype html>
  <html lang="en"><style>
    html { background: white; }
    .preview { position: relative; display: grid; place-items: center; overflow: hidden; ${preview} }
    .preview img { display: block; ${image} }
  </style><div class="preview"><img alt="Portrait artwork" src="${src}"></div></html>`;

test('fullImageSelectors is opt-in and validates its selector list', () => {
  assert.deepEqual(validatePolicy().fullImageSelectors, []);
  for (const value of [null, false, '.preview img', [null], [' ']]) {
    assert.throws(() => validatePolicy({ fullImageSelectors: value }), /fullImageSelectors/);
  }
});

test('image framing catches cropped portrait previews at mobile and desktop widths', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const frame = 'width: min(55vw, 280px); aspect-ratio: 16 / 10; border-radius: 8px;';
      const image = 'width: 100%; height: 100%; object-fit: contain;';
      await page.setContent(fixture(frame, image));
      const original = (await checkPage(page, policy)).findings.filter(item => item.rule === 'image-framing');
      assert.equal(original.length, 1);
      assert.match(original[0].actual, /bottom crop [\d.]+px/);
      assert.match(original[0].relatedSelector ?? '', /div/);
      assert.ok(!(await checkPage(page)).findings.some(item => item.rule === 'image-framing'));

      await page.setContent(fixture(frame, image + ' position: absolute; inset: 0;'));
      assert.ok(!(await checkPage(page, policy)).findings.some(item => item.rule === 'image-framing'));
    }
  } finally { await browser.close(); }
});

test('image framing measures the fitted object and distinguishes unmeasured states', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const frame = 'width: 200px; height: 200px;';
    const size = 'width: 200px; height: 200px;';
    for (const [name, css, actual, status] of [
      ['full image', 'object-fit: contain;', undefined, undefined],
      ['full image at the right edge', 'object-fit: contain; object-position: right top;', undefined, undefined],
      ['offset outside the frame', 'object-fit: contain; object-position: right -12px top 0px;', 'right crop 12px', undefined],
      ['flipped offset', 'object-fit: contain; object-position: right -12px top 0px; transform: scaleX(-1);', 'left crop 12px', undefined],
      ['cover crop', 'object-fit: cover;', 'top crop 166.67px, bottom crop 166.67px', undefined],
      ['masked image', 'object-fit: contain; mask-image: linear-gradient(transparent, black);', 'image or clip bounds could not be measured as rectangles', 'unresolved'],
      ['rotated image', 'object-fit: contain; transform: rotate(15deg);', 'image or clip bounds could not be measured as rectangles', 'unresolved'],
      ['hidden image', 'display: none;', undefined, undefined],
    ] as const) {
      await page.setContent(fixture(frame, size + css));
      const findings = (await checkPage(page, policy)).findings.filter(item => item.rule === 'image-framing');
      assert.deepEqual(findings.map(item => [item.actual, item.status]), actual ? [[actual, status]] : [], name);
    }

    await page.setContent(fixture(frame, size, 'data:image/png,broken'));
    const broken = (await checkPage(page, policy)).findings.find(item => item.rule === 'image-framing');
    assert.equal(broken?.actual, 'image dimensions are unavailable');
    assert.equal(broken?.status, 'unresolved');

    for (const effect of ['mask-image:linear-gradient(transparent,black)', 'clip-path:inset(50%)']) {
      await page.setContent(fixture(frame, size + 'position:absolute;inset:0;object-fit:contain;')
        .replace('<img', `<div style="width:100%;height:100%;${effect}"><img`)
        .replace('</div></html>', '</div></div></html>'));
      assert.equal((await checkPage(page, policy)).findings.find(item => item.rule === 'image-framing')?.status, 'unresolved', effect);
    }

    const cover = size + 'object-fit: cover; display: inline;';
    await page.setContent(fixture('width: 500px; height: 560px;', cover));
    assert.match((await checkPage(page, policy)).findings.find(item => item.rule === 'image-framing')?.actual ?? '', /top crop/);
    await page.setContent(fixture('width: 500px; height: 560px;', cover + 'overflow: visible;'));
    assert.ok(!(await checkPage(page, policy)).findings.some(item => item.rule === 'image-framing'));
    await page.setContent(fixture(frame, cover + 'overflow: visible;'));
    const ancestor = (await checkPage(page, policy)).findings.find(item => item.rule === 'image-framing');
    assert.match(ancestor?.actual ?? '', /top crop/);
    assert.match(ancestor?.relatedSelector ?? '', /div/);
    await page.setContent(fixture('width: 500px; height: 560px;', cover + 'overflow-clip-margin: 200px;'));
    assert.ok(!(await checkPage(page, policy)).findings.some(item => item.rule === 'image-framing'));

    await assert.rejects(checkPage(page, { fullImageSelectors: ['['] }));
  } finally { await browser.close(); }
});

test('full-image framing does not pass rounded clips as complete rectangles', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const rounded of ['frame', 'image', 'calculated']) {
        await page.setContent(fixture('width:120px;height:320px;' + (rounded === 'frame' ? 'border-radius:60px;' : rounded === 'calculated' ? 'border-radius:calc(20% + 1px);' : ''),
          'width:120px;height:320px;object-fit:contain;' + (rounded === 'image' ? 'border-radius:60px;' : '')));
        await page.locator('img').evaluate((image: HTMLImageElement) => image.decode());
        const report = await checkPage(page, policy);
        assert.equal(report.findings.find(item => item.rule === 'image-framing')?.status, 'unresolved', `${width} ${rounded}`);
      }
    }
  } finally { await browser.close(); }
});
