import { AssertionError } from 'node:assert';
import { checkPage } from './index.js';
import { loadProjectPolicy } from './project.js';

export async function expectUI(page, testInfo, policy) {
  const report = await checkPage(page, policy === undefined ? await loadProjectPolicy() : policy);
  if (!report.findings.length) return;
  await testInfo.attach('lintapple findings', {
    body: JSON.stringify({ url: page.url(), viewport: page.viewportSize(), ...report }, null, 2),
    contentType: 'application/json',
  });
  throw new AssertionError({
    message: `lintapple found ${report.findings.length} UI findings.\n\n${report.findings.map(f => `${f.rule}: ${f.selector}\n${f.message}\nFix: ${f.fix}`).join('\n\n')}`,
    actual: report.findings,
    expected: [],
    operator: 'expectUI',
    stackStartFn: expectUI,
  });
}
