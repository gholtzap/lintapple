import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { checkPage, checkUrl } from '../src/index.js';

const fixture = content => `<!doctype html><html><style>
html { background:white; font:16px/24px system-ui; }
body { margin:0; min-height:1px; }
.crop { width:80px; white-space:nowrap; overflow:hidden; }
</style><body>${content}</body></html>`;
const newRules = result => result.findings.filter(f => ['viewport-bounds', 'content-clipping'].includes(f.rule));

test('layout checks detect overflow and clipped text without rejecting page or local scrolling', async () => {
  const browser = await chromium.launch();
  const receipt = [];
  try {
    const page = await browser.newPage();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 600 });
      const cases = [
        { name:'normal vertical page', html:fixture('<main style="height:1600px"><p>Content</p></main>'), rules:[] },
        { name:'off-screen left component', html:fixture('<div id="target" style="position:absolute;left:-8px;width:32px;height:32px"></div>'), rules:['viewport-bounds'] },
        { name:'off-screen right with hidden page overflow', html:fixture('<style>html {overflow-x:hidden}</style><div style="width:calc(100vw + 20px);height:32px"></div>'), rules:['viewport-bounds'] },
        { name:'fixed below screen', html:fixture('<div style="position:fixed;top:610px;width:32px;height:32px">Menu</div>'), rules:['viewport-bounds'] },
        { name:'fixed above screen', html:fixture('<div style="position:fixed;top:-32px;width:32px;height:24px">Menu</div>'), rules:['viewport-bounds'] },
        { name:'fixed descendant outside screen', html:fixture('<div style="position:fixed;top:0"><div style="margin-top:610px">Menu</div></div>'), rules:['viewport-bounds'] },
        { name:'oversized open dialog', html:fixture('<dialog open style="height:800px;max-height:none;border:0;margin:0;top:0">Dialog</dialog>'), rules:['viewport-bounds'] },
        { name:'closed dialog', html:fixture('<dialog style="width:2000px">Hidden</dialog>'), rules:[] },
        { name:'hidden off-screen component', html:fixture('<div hidden style="position:fixed;left:-100px">Hidden</div>'), rules:[] },
        { name:'local horizontal scrolling', html:fixture('<div style="width:200px;overflow-x:auto"><div style="width:1000px">Wide table</div></div>'), rules:[] },
        { name:'scroll region itself outside screen', html:fixture('<div style="width:calc(100vw + 20px);overflow-x:auto"><div style="width:2000px">Wide table</div></div>'), rules:['viewport-bounds'] },
        { name:'scrollable overlay content', html:fixture('<div role="dialog" style="position:fixed;width:200px;height:100px;overflow-y:auto"><div style="height:900px">Scrollable content</div></div>'), rules:[] },
        { name:'fixed child escapes local scroll region', html:fixture('<div style="width:200px;overflow:auto"><div style="position:fixed;top:610px">Menu</div></div>'), rules:['viewport-bounds'] },
        { name:'long word clipped horizontally', html:fixture('<p class="crop">AnUnbrokenWordThatDoesNotFitInThisBox</p>'), rules:['content-clipping'] },
        { name:'very long clipped word stays a clipping error', html:fixture('<p class="crop">' + 'LongWord'.repeat(40) + '</p>'), rules:['content-clipping'] },
        { name:'inline wrapper clipped by parent', html:fixture('<div class="crop"><span>AnUnbrokenWordThatDoesNotFitInThisBox</span></div>'), rules:['content-clipping'] },
        { name:'text clipped vertically', html:fixture('<p style="height:8px;overflow:hidden">Text</p>'), rules:['content-clipping'] },
        { name:'text beyond screen with fitting element box', html:fixture('<p style="width:80px;white-space:nowrap">' + 'LongWord'.repeat(40) + '</p>'), rules:['viewport-bounds'] },
        { name:'ellipsis still requires an exception', html:fixture('<p class="crop" style="text-overflow:ellipsis">A long label that does not fit</p>'), rules:['content-clipping'] },
        { name:'line clamp', html:fixture('<p style="width:80px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden">Several words need more than one line here</p>'), rules:['content-clipping'] },
        { name:'border does not expand clipping area', html:fixture('<p style="width:30px;white-space:nowrap;overflow:hidden;border:40px solid #ddd">TooLong</p>'), rules:['content-clipping'] },
        { name:'wrapped text fits', html:fixture('<p style="width:80px;overflow:hidden;overflow-wrap:anywhere">AnUnbrokenWordThatFitsWhenWrapped</p>'), rules:[] },
        { name:'scaled clipping box', html:fixture('<p class="crop" style="transform:scale(.5);transform-origin:top left">AnUnbrokenWordThatDoesNotFitInThisBox</p>'), rules:['content-clipping'] },
      ];
      for (const entry of cases) {
        await page.setContent(entry.html);
        const result = await checkPage(page);
        const findings = newRules(result);
        assert.deepEqual([...new Set(findings.map(f => f.rule))].sort(), [...entry.rules].sort(), `${width}px ${entry.name}: ${JSON.stringify(findings)}`);
        assert.ok(findings.every(f => f.selector && f.actual && f.expected && f.fix));
        receipt.push({ width, name:entry.name, expected:entry.rules, findings });
      }
      await page.setContent(fixture('<div style="height:1200px"></div><p>Below the initial screen</p>'));
      await page.evaluate(() => scrollTo(0, 1000));
      assert.deepEqual(newRules(await checkPage(page)), [], 'Page scrolling is valid');
      await page.setContent(fixture('<div style="width:200px;overflow:auto" id="scroll"><div style="width:1000px">Wide content</div></div>'));
      await page.locator('#scroll').evaluate(el => { el.scrollLeft = 500; });
      assert.deepEqual(newRules(await checkPage(page)), [], 'Scrolled local content remains accessible');
    }
    await page.setContent(fixture('<p class="crop">A long label that does not fit</p>'));
    const excepted = await checkPage(page, { exceptions:[{selector:'.crop',rules:['content-clipping'],reason:'The full label is available in the detail view.'}] });
    assert.deepEqual(newRules(excepted), []);
    assert.ok(excepted.suppressed.some(f => f.rule === 'content-clipping'));
    await page.setContent(fixture('<div id="target" style="position:absolute;left:-8px;width:32px;height:32px"></div><p class="crop">A long label that does not fit</p>'));
    const viewportException = await checkPage(page, { exceptions:[{selector:'#target',rules:['viewport-bounds'],reason:'This element is part of a partially visible carousel.'}] });
    assert.ok(!viewportException.findings.some(f => f.rule === 'viewport-bounds'));
    assert.ok(viewportException.findings.some(f => f.rule === 'content-clipping'));
    await mkdir('test-results', { recursive:true });
    await writeFile('test-results/layout-bounds.html', fixture('<div style="position:absolute;left:-8px;width:32px;height:32px"></div><p class="crop">A long label that does not fit</p>'));
    const url = new URL('../test-results/layout-bounds.html', import.meta.url).href;
    const report = await checkUrl(url);
    assert.deepEqual([...new Set(newRules(report).map(f => f.rule))].sort(), ['content-clipping','viewport-bounds']);
    assert.deepEqual(await checkUrl(url), report, 'Stable page produces a stable report');
    await writeFile('test-results/layout-bounds-report.json', JSON.stringify(report,null,2));
    await writeFile('test-results/layout-bounds-receipt.json', JSON.stringify({command:'npm test',inputs:'test/layout-bounds.test.js',node:process.version,cases:receipt},null,2));
  } finally { await browser.close(); }
});
