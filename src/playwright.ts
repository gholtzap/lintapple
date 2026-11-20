import type { Page } from 'playwright';
import type { TestInfo } from 'playwright/test';
import type { Policy } from './types.js';
import { AssertionError } from 'node:assert';
import { checkPage } from './index.js';
import { summarizeFindings, formatSummary, formatFrameCoverage } from './report.js';
import { loadProjectPolicy } from './project.js';

export async function expectUI(page: Page, testInfo: Pick<TestInfo, 'attach'>, policy?: Partial<Policy>) {
  const report = await checkPage(page, policy === undefined ? await loadProjectPolicy() : policy);
  const summary = summarizeFindings(report.findings);
  if (!report.findings.length && !report.frameCoverage.omitted.length && !report.controlContentCoverage.unmeasured.length && !report.accessibilityCoverage.tooltips?.unmeasured.length) return;
  await testInfo.attach(report.findings.length ? 'lintapple findings' : 'lintapple coverage', {
    body: JSON.stringify({ url: page.url(), viewport: page.viewportSize(), ...report, summary }, null, 2),
    contentType: 'application/json',
  });
  if (!report.findings.length) return;
  throw new AssertionError({
    message: `lintapple found ${report.findings.length} UI findings.\n${formatSummary(summary)}\n${formatFrameCoverage([report.frameCoverage])}`,
    actual: report.findings,
    expected: [],
    operator: 'expectUI',
    stackStartFn: expectUI,
  });
}
