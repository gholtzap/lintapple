import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { checkPage } from '../src/index.js';
import type { PageReport, Policy, RuleId, Status } from '../src/types.js';

export const html = (css: string, body: string) => `<!doctype html><html lang="en"><title>Rule regression</title><style>html{background:white;color:#111;font:16px/24px system-ui}body{margin:24px}p{margin:0}button,input,textarea,select{font:inherit;color:#111;background:white}${css}</style><body>${body}</body></html>`;

export async function auditCases(id: string, rule: RuleId, cases: { name: string; html: string; expected: Status[]; policy?: Partial<Policy> }[]) {
  const browser = await chromium.launch();
  const reports: { name: string; width: number; colorScheme: string; report: PageReport }[] = [];
  await mkdir('test-results', { recursive: true });
  try {
    for (const width of [390, 1440]) for (const colorScheme of ['light', 'dark'] as const) for (const entry of cases) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
      try {
        await page.setContent(entry.html);
        const report = await checkPage(page, entry.policy);
        reports.push({ name: entry.name, width, colorScheme, report });
        assert.deepEqual(report.findings.filter(f => f.rule === rule).map(f => f.status ?? 'failed'), entry.expected, `${id}: ${entry.name}, ${width}px, ${colorScheme}: ${JSON.stringify(report.findings)}`);
      } finally { await page.close(); }
    }
  } finally {
    await writeFile(`test-results/${id}.json`, JSON.stringify(reports, null, 2));
    await browser.close();
  }
}
