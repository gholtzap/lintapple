import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { checkPage } from '../src/index.js';
import type { Finding } from '../src/types.js';

const fixture = (css = '') => `<!doctype html><html lang="en"><style>
  html { background: #080f1f; color: #f3f7ff; font: 13px/1.5 system-ui; }
  body { margin: 0; }
  svg { display: block; width: 100%; height: 640px; }
  dialog { box-sizing: border-box; width: min(358px, calc(100% - 32px)); padding: 24px; border: 0; background: #142442; color: #f3f7ff; }
  p { background: #142442; }
  button { font: inherit; }
  ${css}
</style><body>
  <svg aria-hidden="true" viewBox="0 0 390 640" preserveAspectRatio="none">
    ${Array.from({ length: 24 }, (_, index) => `<rect x="${index % 2 ? 120 : 170}" y="${index * 27}" width="100" height="20" fill="#55c5ff"/>`).join('')}
  </svg>
  <dialog aria-label="Help"><button autofocus onclick="this.closest('dialog').close()">Close</button>
    <p id="instructions">Pin the named city. Drag the map to pan or drag your pin to adjust it. Arrow keys move the pin; hold Shift for finer adjustment.</p>
    <p id="score">Your score is the total distance you were off across five cities. Lower is better.</p>
    <p id="reset">The daily game resets at midnight in New York.</p>
  </dialog>
</body></html>`;

test('modal text contrast measures opaque Help over SVG without changing the page', async () => {
  const browser = await chromium.launch();
  const receipt: { width: number; colorScheme: 'light' | 'dark'; name: string; expected: string | null; findings: Finding[] }[] = [];
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, colorScheme });
      try {
        for (const entry of [
          { name: 'opaque', css: '', expected: null },
          { name: 'low contrast', css: 'p { color: #243452; }', expected: 'failed' },
          { name: 'transparent', css: 'dialog, p { background: transparent; }', expected: 'unresolved' },
          { name: 'gradient', css: 'p { background: linear-gradient(white, black); }', expected: 'unresolved' },
        ]) {
          await page.setContent(fixture(entry.css));
          await page.locator('dialog').evaluate((dialog: HTMLDialogElement) => dialog.showModal());
          const before = await page.locator('body').evaluate(el => el.outerHTML);
          const report = await checkPage(page);
          const findings = report.findings.filter(f => f.rule === 'text-contrast' && f.selector.includes('dialog'));
          assert.equal(await page.locator('body').evaluate(el => el.outerHTML), before);
          assert.equal(await page.locator('dialog').evaluate((dialog: HTMLDialogElement) => dialog.open), true);
          if (entry.expected) {
            assert.equal(findings.filter(f => f.status === entry.expected && f.selector.includes('p:nth-of-type')).length, 3, `${entry.name}, ${width}, ${colorScheme}: ${JSON.stringify(findings)}`);
            if (entry.expected === 'failed') assert.ok(findings.some(f => f.contrastRatio === 1.24));
          } else assert.deepEqual(findings, [], `${entry.name}, ${width}, ${colorScheme}`);
          receipt.push({ width, colorScheme, name: entry.name, expected: entry.expected, findings });
        }
      } finally { await page.close(); }
    }
    await mkdir('test-results', { recursive: true });
    await writeFile('test-results/modal-contrast.json', JSON.stringify(receipt, null, 2));
  } finally { await browser.close(); }
});
