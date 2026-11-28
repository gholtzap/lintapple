import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';
import { html } from './audit-cases.js';

test('font rules check visible native options and text pseudo-elements', async () => {
  const cases = [
    ['file', 'input::file-selector-button{font:17px serif}', '<label>Upload<input type="file"></label>', '::file-selector-button'],
    ['marker', 'li::marker{content:"Status ";font:17px serif}', '<ul><li>Project</li></ul>', '::marker'],
    ['letter', 'p::first-letter{font:17px serif}', '<p>Project ready</p>', '::first-letter'],
    ['line', 'p::first-line{font:17px serif}', '<p>Project ready</p>', '::first-line'],
    ['option', 'option{font:17px serif}', '<label>Choice<select size="3"><option>First</option></select></label>', 'option:nth-of-type(1)'],
    ['option group', 'optgroup{font:17px serif}option{font:16px system-ui}', '<label>Choice<select size="4"><optgroup label="Options"><option>First</option></optgroup></select></label>', 'optgroup:nth-of-type(1)'],
  ];
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
      try {
        for (const [name, css, body, suffix] of cases) {
          for (const valid of [false, true]) {
            await page.setContent(html(valid ? css.replaceAll('17px serif', '16px system-ui') : css, body));
            const findings = (await checkPage(page)).findings.filter(f => ['font-size', 'font-family'].includes(f.rule));
            assert.deepEqual(findings.map(f => f.rule).sort(), valid ? [] : ['font-family', 'font-size'], `${name}: ${JSON.stringify(findings)}`);
            assert.ok(findings.every(f => f.selector.endsWith(suffix)));
          }
        }
        await page.setContent(html('span::first-letter,p::first-line,li::marker{font:17px serif}li::marker{content:none}', '<span>Inline text</span><p></p><ul><li>Project</li></ul><label>Choice<select><option style="font:17px serif">Closed popup</option></select></label>'));
        assert.deepEqual((await checkPage(page)).findings.filter(f => ['font-size', 'font-family'].includes(f.rule)), []);
        for (const group of ['<optgroup label="Options" hidden>', '<optgroup label=" ">']) {
          await page.setContent(html('optgroup{font:17px serif}option{font:16px system-ui}', `<label>Choice<select size="4">${group}<option>First</option></optgroup></select></label>`));
          assert.deepEqual((await checkPage(page)).findings.filter(f => ['font-size', 'font-family'].includes(f.rule)), []);
        }
        await page.setContent(html('select,select::picker(select){appearance:base-select}optgroup{font:17px serif}legend,option{font:16px system-ui}', '<label>Choice<select size="4"><optgroup label="Unused"><legend>Group heading</legend><option>First</option></optgroup></select></label>'));
        assert.deepEqual((await checkPage(page)).findings.filter(f => ['font-size', 'font-family'].includes(f.rule)), []);
        await page.locator('legend').evaluate(el => (el as HTMLElement).style.font = '17px serif');
        const legendFonts = (await checkPage(page)).findings.filter(f => ['font-size', 'font-family'].includes(f.rule));
        assert.deepEqual(legendFonts.map(f => f.rule).sort(), ['font-family', 'font-size']);
        assert.ok(legendFonts.every(f => f.selector.endsWith('legend:nth-of-type(1)')));
        await page.locator('legend').evaluate(el => (el as HTMLElement).style.display = 'none');
        assert.deepEqual((await checkPage(page)).findings.filter(f => ['font-size', 'font-family'].includes(f.rule)), []);

        await page.setContent(html('optgroup{font:17px serif}option{font:16px system-ui}', '<label>Choice<select><optgroup label="Options"><option>First</option></optgroup></select></label>'));
        assert.deepEqual((await checkPage(page)).findings.filter(f => ['font-size', 'font-family'].includes(f.rule)), []);

      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
});
